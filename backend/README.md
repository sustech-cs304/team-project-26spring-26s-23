# Backend

<img src="https://img.shields.io/badge/github-repo-blue?logo=github" alt="GitHub Repo" />
<img src="https://img.shields.io/badge/Python-3.12-orange?logo=python" alt="Python Version" />

## 📕 Introduction

This is the backend of our project. It is built using Python.

## ⚙ Setup

1. Install Python 3.12 or higher.
2. We recommend to use `uv` to manage dependencies. You can install it using pip:

   ```bash
   pip install uv
   ```

3. Install the dependencies:

   ```bash
   cd backend
   uv sync
    ```

## ▶ Running the Server

...

## 🧰 Blackboard CLI

run at `backend/`:

```bash
python -m app.blackboard.provider.cli.search_course_catalog --help
python -m app.blackboard.provider.cli.sync_calendar_ics --help
```

## 💯 Run Tests

run at [`backend/`](backend/README.md:32):

```bash
uv run pytest -c pyproject.toml tests/unit
uv run pyright -p ../pyrightconfig.json
```

GitHub Actions workflow [`.github/workflows/backend-static-checks.yml`](.github/workflows/backend-static-checks.yml) uses `uv` to install dependencies and runs separated Blackboard / TIS static checks. Live integration tests remain outside CI.
