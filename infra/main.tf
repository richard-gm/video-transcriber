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

# ── Service account ───────────────────────────────────────────────────────────
# Used by both the Cloud Run service and the Cloud Run Job.
resource "google_service_account" "cloudrun" {
  account_id   = "video-transcriber"
  display_name = "Video Transcriber Cloud Run"
}

# Pull Docker images from Artifact Registry
resource "google_project_iam_member" "cloudrun_artifact_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# ── Cloud Tasks queue ─────────────────────────────────────────────────────────
# Requires Cloud Tasks API: console.cloud.google.com/apis/library/cloudtasks.googleapis.com
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

# Allow the service account to enqueue Cloud Tasks
resource "google_project_iam_member" "cloudrun_task_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Allow the service account to execute Cloud Run Jobs
# Note: the Job itself is managed by deploy.yml, not Terraform
resource "google_project_iam_member" "cloudrun_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.cloudrun.email}"
}

# ── Cloud Run Service IAM ─────────────────────────────────────────────────────
# Allow Cloud Tasks (using the same SA) to invoke the task handler endpoint.
resource "google_cloud_run_service_iam_member" "task_handler_invoker" {
  project  = var.project_id
  location = var.region
  service  = "video-transcriber"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloudrun.email}"
}
