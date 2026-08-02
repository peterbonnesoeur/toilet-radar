.PHONY: help install migrate migrate-up migrate-down migrate-history migrate-current test-db populate enrich clean-python

# All database-touching targets honour APP_ENV (local | dev | prd), default local.
# Example: make migrate-up APP_ENV=prd
APP_ENV ?= local

help: ## Show this help message
	@echo "Available commands (APP_ENV=$(APP_ENV)):"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Migration Management
migrate: ## Create new migration (usage: make migrate MSG="description")
	@if [ -z "$(MSG)" ]; then echo "Usage: make migrate MSG='your description'"; exit 1; fi
	APP_ENV=$(APP_ENV) uv run alembic revision --autogenerate -m "$(MSG)"

migrate-up: ## Apply all pending migrations
	APP_ENV=$(APP_ENV) uv run alembic upgrade head

migrate-down: ## Rollback last migration
	APP_ENV=$(APP_ENV) uv run alembic downgrade -1

migrate-history: ## Show migration history
	uv run alembic history

migrate-current: ## Show current migration
	APP_ENV=$(APP_ENV) uv run alembic current

# Development
install: ## Install dependencies
	uv sync
	npm install

test-db: ## Test database connection
	APP_ENV=$(APP_ENV) uv run python -c "from sqlalchemy import text; from db.engine import SessionLocal; s = SessionLocal(); s.execute(text('SELECT 1')); print('✅ Database connection successful')"

# Data pipelines
populate: ## Import/refresh OSM toilets (usage: make populate COUNTRY=CH)
	APP_ENV=$(APP_ENV) node scripts/populateFromOSM.mjs --country=$(or $(COUNTRY),CH)

enrich: ## Reverse-geocode missing addresses via Nominatim (1 req/s)
	APP_ENV=$(APP_ENV) node scripts/enrichAddresses.mjs

clean-python: ## Clean up Python cache
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
	find . -name "*.pyc" -type f -delete
