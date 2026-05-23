terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Artifact Registry ─────────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "repo" {
  repository_id = "video-transcriber"
  location      = var.region
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state = "UNTAGGED"
    }
  }
}

# ── Cloud Run service ─────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "app" {
  name     = "video-transcriber"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 1   # BILL PROTECTION — never more than 1 instance
    }

    timeout = "3600s"  # 1 hour max — covers long videos

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}/app:latest"

      # BILL PROTECTION — restrict resources per container
      resources {
        cpu_idle          = true
        startup_cpu_boost = true
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      env {
        name  = "SUPABASE_URL"
        value = var.supabase_url
      }
      env {
        name  = "SUPABASE_ANON_KEY"
        value = var.supabase_anon_key
      }
      env {
        name  = "SUPABASE_TABLE"
        value = var.supabase_table
      }
      env {
        name  = "TELEGRAM_BOT_TOKEN"
        value = var.telegram_bot_token
      }
      env {
        name  = "TELEGRAM_SECRET_TOKEN"
        value = var.telegram_secret_token
      }
      env {
        name  = "WHISPER_MODEL"
        value = var.whisper_model
      }
      env {
        name  = "MAX_CONCURRENT_JOBS"
        value = "1"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      startup_probe {
        tcp_socket {
          port = 8080
        }
        initial_delay_seconds = 60
        timeout_seconds       = 10
        period_seconds        = 15
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 120
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3
      }
    }

    service_account = google_service_account.cloudrun.email
  }

  depends_on = [google_artifact_registry_repository.repo]
}

# ── Service account ───────────────────────────────────────────────────────────
resource "google_service_account" "cloudrun" {
  account_id   = "video-transcriber"
  display_name = "Video Transcriber Cloud Run"
}

resource "google_project_iam_member" "cloudrun_artifact_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# ── Public access (Telegram webhook) ──────────────────────────────────────────
resource "google_cloud_run_v2_service_iam_member" "public" {
  location = google_cloud_run_v2_service.app.location
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
