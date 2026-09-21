PORT ?= 8101
PY := .venv/bin/python

.PHONY: demo install build test dev-api dev-web screenshots clean

demo: install build        ## one command: build the web app and run everything on one port
	@echo "Quote Desk is starting on http://localhost:$(PORT)"
	.venv/bin/uvicorn quote_agent.api:app --host 127.0.0.1 --port $(PORT)

install: .venv/.installed
.venv/.installed: pyproject.toml
	python3 -m venv .venv
	.venv/bin/pip install -q -e ".[web,dev]"
	touch .venv/.installed

build: web/dist/index.html
web/dist/index.html: web/package.json $(shell find web/src -type f) web/index.html
	cd web && npm install --no-audit --no-fund && npm run build

test: install
	.venv/bin/pytest -q

dev-api: install           ## API with reload, pair with `make dev-web`
	.venv/bin/uvicorn quote_agent.api:app --reload --port $(PORT)

dev-web:                   ## Vite dev server on :5173, proxies /api to :$(PORT)
	cd web && npm run dev

screenshots:               ## needs a running demo and Google Chrome
	scripts/capture_screens.sh docs/screens http://localhost:$(PORT)

clean:
	rm -rf web/dist data
