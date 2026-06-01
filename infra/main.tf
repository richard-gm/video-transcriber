terraform {
  backend "gcs" {
    bucket = "video-transcriber-tfstate"
    prefix = "terraform/state"
  }
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

# Artifact Registry — stores Docker images. If builds fail, check this exists.
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

# Service account — used by Cloud Run to pull images from Artifact Registry.
resource "google_service_account" "cloudrun" {
  account_id   = "video-transcriber"
  display_name = "Video Transcriber Cloud Run"
}

# Grants the Cloud Run SA permission to pull Docker images from Artifact Registry.
resource "google_project_iam_member" "cloudrun_artifact_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# ── Cloud Tasks queue ─────────────────────────────────────────────────────────
# Requires Cloud Tasks API enabled: console.cloud.google.com/apis/library/cloudtasks.googleapis.com
resource "google_cloud_tasks_queue" "transcription" {
  name     = "transcription-queue"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 1
    max_dispatches_per_second = 1
  }

  retry_config {
    max_attempts = 3
    min_backoff  = "60s"
    max_backoff  = "600s"
  }
}

# ── Cloud Run Job (long-running worker) ───────────────────────────────────────
resource "google_cloud_run_v2_job" "worker" {
  name     = "video-transcriber-worker"
  location = var.region

  template {
    task_count = 1
    timeout    = "36000s"  # 10 hours — no ceiling like Cloud Run services

    template {
      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/video-transcriber/app:latest"
        command = ["node"]
        args    = ["worker.js"]

        resources {
          cpu_idle          = false
          startup_cpu_boost = true
          limits = {
            cpu    = var.worker_cpu
            memory = var.worker_memory
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
          name  = "WHISPER_MODEL"
          value = var.whisper_model
        }
        env {
          name  = "TELEGRAM_BOT_TOKEN"
          value = var.telegram_bot_token
        }
        env {
          name  = "LOG_LEVEL"
          value = "info"
        }
      }

      service_account = google_service_account.cloudrun.email
    }
  }

  depends_on = [google_artifact_registry_repository.repo]
}

# Allow the Cloud Run service account to create job executions
resource "google_project_iam_member" "cloudrun_run_admin" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Allow the Cloud Run service account to enqueue Cloud Tasks
resource "google_project_iam_member" "cloudrun_task_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Allow Cloud Tasks to invoke the task handler on the service
# (the service itself is deployed by GitHub Actions — the name must match)
resource "google_cloud_run_service_iam_member" "task_handler_invoker" {
  project  = var.project_id
  location = var.region
  service  = "video-transcriber"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloudrun.email}"
}
