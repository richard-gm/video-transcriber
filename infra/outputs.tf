output "cloud_run_url" {
  description = "Cloud Run service URL — set this as your Telegram webhook"
  value       = google_cloud_run_v2_service.app.uri
}

output "setup_commands" {
  description = "One-time setup commands"
  value = <<EOT

# 1. Set the Telegram webhook (run this once after deploy):
curl -X POST "https://api.telegram.org/bot${var.telegram_bot_token}/setWebhook" \
  -d "url=${google_cloud_run_v2_service.app.uri}/telegram-webhook" \
  -d "secret_token=${var.telegram_secret_token}"

# 2. To verify the webhook is set:
curl "https://api.telegram.org/bot${var.telegram_bot_token}/getWebhookInfo"

EOT
}
