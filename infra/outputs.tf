output "setup_commands" {
  description = "One-time setup commands"
  sensitive   = true
  value = <<EOT

# Set the Telegram webhook (run this after first deploy):
# Get the URL from the GitHub Actions "Show deploy URL" step, then:
curl -X POST "https://api.telegram.org/bot${var.telegram_bot_token}/setWebhook" \
  -d "url=CLOUD_RUN_URL/telegram-webhook" \
  -d "secret_token=${var.telegram_secret_token}"

# To verify:
curl "https://api.telegram.org/bot${var.telegram_bot_token}/getWebhookInfo"
EOT
}
