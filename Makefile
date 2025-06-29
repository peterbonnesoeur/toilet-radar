.PHONY: help db-up db-down db-reset db-logs db-shell migrate migrate-up migrate-down migrate-history env-local env-prod clean check-docker

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Migration Management
migrate: ## Create new migration (usage: make migrate MSG="description")
	@if [ -z "$(MSG)" ]; then echo "Usage: make migrate MSG='your description'"; exit 1; fi
	uv run alembic revision --autogenerate -m "$(MSG)"

migrate-up: ## Apply all pending migrations
	uv run alembic upgrade head

migrate-down: ## Rollback last migration
	uv run alembic downgrade -1

migrate-history: ## Show migration history
	uv run alembic history

migrate-current: ## Show current migration
	uv run alembic current

# Development
install: ## Install dependencies
	uv sync

test-db: ## Test database connection
	uv run python -c "from db.engine import SessionLocal; print('✅ Database connection successful')"

clean: ## Clean up containers and volumes
	docker-compose down -v
	docker system prune -f

clean-python: ## Clean up Python cache
	find . -name "__pycache__" -type d -exec rm -rf {} +
	find . -name "*.pyc" -type f -delete
	find . -name "*.pyo" -type f -delete
	find . -name "*.pyd" -type f -delete
	find . -name "*.pyw" -type f -delete
	find . -name "*.pyz" -type f -delete
	find . -name "*.pywz" -type f -delete
	find . -name "*.pyzw" -type f -delete