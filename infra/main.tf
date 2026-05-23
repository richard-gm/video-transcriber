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
