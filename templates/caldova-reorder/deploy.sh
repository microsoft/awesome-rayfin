#!/usr/bin/env bash
#
# Deploy the Caldova demo data and semantic model into an existing Fabric workspace.
#
# This script never creates or deletes a workspace, and never signs you in.
# Authenticate fabio yourself first; the script only checks that it is ready.

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$ROOT_DIR/data"
GENERATED_DIR="$DATA_DIR/generated"
FABRIC_DIR="$ROOT_DIR/fabric"
DAX_DIR="$FABRIC_DIR/dax"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
WORK_DIR="$ROOT_DIR/.deploy-work"

MODEL_FOLDER_NAME="caldova-operations.SemanticModel"
MODEL_SOURCE_DIR="$FABRIC_DIR/$MODEL_FOLDER_NAME"
DATABASE_QUERY_TOKEN="{{DATABASE_QUERY_SOURCE}}"
RESTOCK_QUERY_TOKEN="{{RESTOCK_QUERY_SOURCE}}"

TABLE_SPECS="stores:stores.csv products:products.csv inventory:inventory.csv sales:sales.csv"
RESTOCK_COLUMNS="id store_id sku qty requested_by requested_by_id requested_at status note"

DRY_RUN=0
RESET_ONLY=0
SKIP_GENERATE=0
SKIP_DATA=0
CAPACITY_OVERRIDE=""

FABRIC_WORKSPACE_ID="${FABRIC_WORKSPACE_ID:-}"
FABRIC_WORKSPACE_NAME="${FABRIC_WORKSPACE_NAME:-}"
FABRIC_LAKEHOUSE_NAME="${FABRIC_LAKEHOUSE_NAME:-}"
FABRIC_SEMANTIC_MODEL_NAME="${FABRIC_SEMANTIC_MODEL_NAME:-}"
FABRIC_MODEL_STORAGE_MODE="${FABRIC_MODEL_STORAGE_MODE:-}"
FABRIC_CAPACITY_ID="${FABRIC_CAPACITY_ID:-}"
FABRIC_LAKEHOUSE_ID="${FABRIC_LAKEHOUSE_ID:-}"
FABRIC_SQL_ENDPOINT_ID="${FABRIC_SQL_ENDPOINT_ID:-}"
FABRIC_SEMANTIC_MODEL_ID="${FABRIC_SEMANTIC_MODEL_ID:-}"
RAYFIN_SQL_DATABASE_ID="${RAYFIN_SQL_DATABASE_ID:-}"
RAYFIN_SQL_ENDPOINT_ID="${RAYFIN_SQL_ENDPOINT_ID:-}"

WORKSPACE_ID=""
LAKEHOUSE_ID=""
SQL_ENDPOINT_ID=""
SQL_ENDPOINT_CONNECTION_STRING=""
SEMANTIC_MODEL_ID=""

export FABIO_NO_VERSION_CHECK=1

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

log() {
  printf '[deploy] %s\n' "$*"
}

warn() {
  printf '[deploy] warning: %s\n' "$*" >&2
}

die() {
  printf '[deploy] error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Load the Caldova dataset into a Fabric lakehouse and deploy the semantic model on top of it.
The target workspace must already exist; this script never creates or deletes one, and never
signs you in to fabio.

Options:
  --dry-run          Validate everything locally and print the Fabric calls without making them.
  --reset            Delete only the named semantic model and lakehouse, then exit.
  --skip-generate    Reuse the CSVs already in data/generated instead of regenerating them.
  --skip-data        Leave the Delta tables alone and only deploy the semantic model.
  --capacity <id>    Assign the workspace to this capacity before deploying.
  -h, --help         Show this help.

Configuration comes from .env; see .env.example for the full list of settings.
EOF
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_env_file() {
  [[ -f "$ENV_FILE" ]] || die "No .env found. Copy .env.example to .env and fill it in."

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [[ -n "$key" ]] || continue

    # Strip one layer of matching quotes, if present.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    case "$key" in
      FABRIC_*|RAYFIN_*)
        eval "$key=\$value"
        ;;
      FABIO_*)
        # Only non-empty overrides are exported. An empty FABIO_ACCESS_TOKEN or
        # endpoint would override fabio's own working defaults with nothing.
        if [[ -n "$value" ]]; then
          eval "$key=\$value"
          export "$key"
        fi
        ;;
    esac
  done <"$ENV_FILE"
}

apply_config_defaults() {
  : "${FABRIC_LAKEHOUSE_NAME:=caldova}"
  : "${FABRIC_SEMANTIC_MODEL_NAME:=caldova-operations}"
  : "${FABRIC_MODEL_STORAGE_MODE:=onelake}"

  [[ -n "$CAPACITY_OVERRIDE" ]] && FABRIC_CAPACITY_ID="$CAPACITY_OVERRIDE"

  case "$FABRIC_MODEL_STORAGE_MODE" in
    onelake|sql) ;;
    *) die "FABRIC_MODEL_STORAGE_MODE must be 'onelake' or 'sql', got '$FABRIC_MODEL_STORAGE_MODE'." ;;
  esac

  if [[ -z "$FABRIC_WORKSPACE_ID" && -z "$FABRIC_WORKSPACE_NAME" ]]; then
    die "Set FABRIC_WORKSPACE_ID or FABRIC_WORKSPACE_NAME in .env. This script never creates a workspace."
  fi
}

# ---------------------------------------------------------------------------
# fabio helpers
# ---------------------------------------------------------------------------

fabio_json() {
  fabio --json --lro-timeout 600 "$@"
}

# Print a single value from a fabio response, using its JMESPath --query support
# so neither this script nor its PowerShell twin needs a JSON parser.
# Always succeeds: a failed call yields an empty value, so callers can report a
# useful error instead of the script dying on errexit.
fabio_value() {
  local query="$1"
  shift
  local output=""
  output="$(fabio --output plain --query "$query" --lro-timeout 600 "$@" 2>/dev/null || true)"
  printf '%s' "$output" | tr -d '\r'
  return 0
}

fabio_retry() {
  local attempt=1
  local max_attempts=4
  while :; do
    if fabio_json "$@" >/dev/null; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      die "fabio command failed after $max_attempts attempts: fabio $*"
    fi
    warn "fabio call failed (attempt $attempt/$max_attempts); retrying in 10s."
    sleep 10
    attempt=$((attempt + 1))
  done
}

preview() {
  log "would run: fabio $*"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found on PATH: $1"
}

check_prerequisites() {
  if ! command -v fabio >/dev/null 2>&1; then
    cat >&2 <<'EOF'
[deploy] error: fabio was not found on PATH.

Install it, then run this script again:
  curl -fsSL https://raw.githubusercontent.com/iemejia/fabio/main/install.sh | bash

This script deliberately does not run remote installers for you.
EOF
    exit 1
  fi

  require_cmd node
  require_cmd npm
  require_cmd awk

  [[ -d "$MODEL_SOURCE_DIR" ]] || die "Semantic model source not found: $MODEL_SOURCE_DIR"
  [[ -f "$MODEL_SOURCE_DIR/definition/model.tmdl" ]] || die "Missing definition/model.tmdl in $MODEL_SOURCE_DIR"
  [[ -f "$DAX_DIR/smoke-test.dax" ]] || die "Missing smoke test query: $DAX_DIR/smoke-test.dax"

  grep -q "$DATABASE_QUERY_TOKEN" "$MODEL_SOURCE_DIR/definition/model.tmdl" \
    || die "model.tmdl no longer contains the $DATABASE_QUERY_TOKEN placeholder; the deploy cannot bind it to a lakehouse."

  grep -q "$RESTOCK_QUERY_TOKEN" "$MODEL_SOURCE_DIR/definition/model.tmdl" \
    || die "model.tmdl no longer contains the $RESTOCK_QUERY_TOKEN placeholder; the deploy cannot bind reorders to the Rayfin database."
}

# fabio is never asked to sign in here. If it is not ready, that is the operator's call.
check_authentication() {
  local status
  status="$(fabio_value "status" auth status)"
  if [[ "$status" != "authenticated" ]]; then
    cat >&2 <<'EOF'
[deploy] error: fabio is not authenticated.

Sign in yourself, then run this script again. This script never runs `fabio auth login`,
because interactive authentication must remain under the operator's control.

Check the current state with:
  fabio auth status
EOF
    exit 1
  fi
  log "fabio is authenticated (source: $(fabio_value "credential_source" auth status))."
}

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

endpoint_hint() {
  cat >&2 <<'EOF'

Verify that the workspace ID or name is correct and that fabio is authenticated
to the tenant that contains it.
EOF
}

resolve_workspace() {
  local resolved_name matches

  if [[ -n "$FABRIC_WORKSPACE_ID" ]]; then
    resolved_name="$(fabio_value "displayName" workspace show --id "$FABRIC_WORKSPACE_ID")"
    if [[ -z "$resolved_name" ]]; then
      printf '[deploy] error: workspace %s was not found.\n' "$FABRIC_WORKSPACE_ID" >&2
      endpoint_hint
      exit 1
    fi
    if [[ -n "$FABRIC_WORKSPACE_NAME" && "$resolved_name" != "$FABRIC_WORKSPACE_NAME" ]]; then
      die "Workspace $FABRIC_WORKSPACE_ID is named '$resolved_name', but .env expects '$FABRIC_WORKSPACE_NAME'."
    fi
    WORKSPACE_ID="$FABRIC_WORKSPACE_ID"
    log "Using workspace '$resolved_name' ($WORKSPACE_ID)"
    return 0
  fi

  matches="$(fabio_value "length([?displayName=='$FABRIC_WORKSPACE_NAME'])" workspace list --all)"
  case "${matches:-0}" in
    1) ;;
    0)
      printf '[deploy] error: no workspace named %s was found.\n' "'$FABRIC_WORKSPACE_NAME'" >&2
      endpoint_hint
      exit 1
      ;;
    *)
      die "Found $matches workspaces named '$FABRIC_WORKSPACE_NAME'. Set FABRIC_WORKSPACE_ID in .env to pick one."
      ;;
  esac

  WORKSPACE_ID="$(fabio_value "[?displayName=='$FABRIC_WORKSPACE_NAME'].id | [0]" workspace list --all)"
  [[ -n "$WORKSPACE_ID" ]] || die "Could not read the id of workspace '$FABRIC_WORKSPACE_NAME'."
  log "Using workspace '$FABRIC_WORKSPACE_NAME' ($WORKSPACE_ID)"
}

assign_capacity() {
  [[ -n "$FABRIC_CAPACITY_ID" ]] || return 0

  local current
  current="$(fabio_value "capacityId" workspace show --id "$WORKSPACE_ID")"
  if [[ "$current" == "$FABRIC_CAPACITY_ID" ]]; then
    log "Workspace is already on capacity $FABRIC_CAPACITY_ID"
    return 0
  fi

  log "Assigning workspace to capacity $FABRIC_CAPACITY_ID"
  fabio_retry workspace assign-capacity --id "$WORKSPACE_ID" --capacity "$FABRIC_CAPACITY_ID"
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

generate_dataset() {
  if (( SKIP_GENERATE )); then
    log "Reusing the CSVs already in data/generated"
  else
    log "Generating the Caldova dataset"
    (cd "$DATA_DIR" && npm run --silent generate)
  fi

  check_dataset_files
}

check_dataset_files() {
  local spec file
  for spec in $TABLE_SPECS; do
    file="${spec##*:}"
    [[ -f "$GENERATED_DIR/$file" ]] || die "Expected dataset file is missing: $GENERATED_DIR/$file. Run 'npm run generate' in data/."
  done
}

resolve_or_create_lakehouse() {
  local matches
  matches="$(fabio_value "length([?displayName=='$FABRIC_LAKEHOUSE_NAME'])" lakehouse list --workspace "$WORKSPACE_ID" --all)"

  case "${matches:-0}" in
    0)
      log "Creating lakehouse '$FABRIC_LAKEHOUSE_NAME'"
      fabio_retry lakehouse create --workspace "$WORKSPACE_ID" --name "$FABRIC_LAKEHOUSE_NAME"
      ;;
    1)
      log "Reusing lakehouse '$FABRIC_LAKEHOUSE_NAME'"
      ;;
    *)
      die "Found $matches lakehouses named '$FABRIC_LAKEHOUSE_NAME' in this workspace. Remove the duplicates first."
      ;;
  esac

  LAKEHOUSE_ID="$(fabio_value "[?displayName=='$FABRIC_LAKEHOUSE_NAME'].id | [0]" lakehouse list --workspace "$WORKSPACE_ID" --all)"
  [[ -n "$LAKEHOUSE_ID" ]] || die "Could not read the id of lakehouse '$FABRIC_LAKEHOUSE_NAME'."

  wait_for_sql_endpoint
  log "Lakehouse $LAKEHOUSE_ID ready, SQL endpoint $SQL_ENDPOINT_ID"
}

wait_for_sql_endpoint() {
  local attempt=1
  while (( attempt <= 30 )); do
    SQL_ENDPOINT_ID="$(fabio_value "properties.sqlEndpointProperties.id" lakehouse show --workspace "$WORKSPACE_ID" --id "$LAKEHOUSE_ID")"
    SQL_ENDPOINT_CONNECTION_STRING="$(fabio_value "properties.sqlEndpointProperties.connectionString" lakehouse show --workspace "$WORKSPACE_ID" --id "$LAKEHOUSE_ID")"
    if [[ -n "$SQL_ENDPOINT_ID" && -n "$SQL_ENDPOINT_CONNECTION_STRING" ]]; then
      return 0
    fi
    log "Waiting for the lakehouse SQL endpoint to come up (attempt $attempt/30)"
    sleep 10
    attempt=$((attempt + 1))
  done
  die "The lakehouse SQL endpoint did not become available in time."
}

upload_tables() {
  local spec table file
  for spec in $TABLE_SPECS; do
    table="${spec%%:*}"
    file="${spec##*:}"
    log "Loading $file into Delta table $table"
    fabio_retry lakehouse upload-table \
      --workspace "$WORKSPACE_ID" \
      --id "$LAKEHOUSE_ID" \
      --source-path "$GENERATED_DIR/$file" \
      --table "$table" \
      --mode Overwrite \
      --format Csv
  done

  log "Refreshing SQL endpoint metadata"
  fabio_retry sql-endpoint refresh-metadata --workspace "$WORKSPACE_ID" --id "$SQL_ENDPOINT_ID"
}

verify_tables() {
  local spec table found missing=""

  for spec in $TABLE_SPECS; do
    table="${spec%%:*}"
    found="$(fabio_value "length([?name=='$table'])" lakehouse list-tables --workspace "$WORKSPACE_ID" --id "$LAKEHOUSE_ID" --all)"
    if [[ "${found:-0}" == "0" ]]; then
      missing="$missing $table"
    fi
  done

  [[ -z "$missing" ]] || die "These Delta tables did not land in the lakehouse:$missing"
  log "All four Delta tables are present"
}

# The semantic model binds RestockRequests by name and type, so check the shape the
# Rayfin app actually created rather than assuming it matches the model definition.
# The table lives in the Rayfin app's SQL database, which Fabric mirrors into OneLake.
report_restock_schema() {
  local sql column types missing=""

  if [[ -z "$RAYFIN_SQL_ENDPOINT_ID" ]]; then
    warn "RAYFIN_SQL_ENDPOINT_ID is not set; skipping the RestockRequests shape check."
    return 0
  fi

  sql="SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestockRequests' ORDER BY ORDINAL_POSITION"

  types="$(fabio_value "[].join(' ', [COLUMN_NAME, DATA_TYPE])" sql-endpoint query --workspace "$WORKSPACE_ID" --id "$RAYFIN_SQL_ENDPOINT_ID" --sql "$sql")"
  if [[ -z "$types" ]]; then
    warn "Could not read the RestockRequests schema from the Rayfin SQL endpoint. Mirroring may still be catching up."
    return 0
  fi

  log "RestockRequests columns:"
  printf '%s\n' "$types" | while IFS= read -r column; do
    [[ -n "$column" ]] && printf '[deploy]   %s\n' "$column"
  done

  for column in $RESTOCK_COLUMNS; do
    printf '%s\n' "$types" | grep -q "^$column " || missing="$missing $column"
  done

  [[ -z "$missing" ]] || die "RestockRequests is missing these columns:$missing"
}

# Reorder history belongs in the Rayfin app's own SQL database, not the lakehouse: the app writes
# there and Fabric mirrors it into OneLake for the model to read. Seeding anywhere else would put
# the same record in two places again.
#
# The generated SQL deletes the seeded ids before inserting them, so a repeat deploy cannot double
# the history, and reorders raised during a demo are untouched because their ids are not in it.
seed_restock_requests() {
  local sql

  if [[ -z "$RAYFIN_SQL_DATABASE_ID" ]]; then
    warn "RAYFIN_SQL_DATABASE_ID is not set; skipping the seeded reorder history."
    return 0
  fi

  log "Seeding reorder history into the Rayfin database"

  sql="$(node "$ROOT_DIR/data/reorder-seed.js" "$GENERATED_DIR/restock_requests.csv")" \
    || die "Could not build the reorder seed SQL."

  fabio_json sql-database query --force --workspace "$WORKSPACE_ID" \
    --id "$RAYFIN_SQL_DATABASE_ID" --sql "$sql" >/dev/null \
    || die "Seeding the reorder history failed."

  log "Seeded reorder history is in place"
}

# ---------------------------------------------------------------------------
# Semantic model
# ---------------------------------------------------------------------------

replace_token() {
  local file="$1" token="$2" value="$3"
  awk -v token="$token" -v value="$value" '
    {
      line = $0
      out = ""
      while ((pos = index(line, token)) > 0) {
        out = out substr(line, 1, pos - 1) value
        line = substr(line, pos + length(token))
      }
      print out line
    }
  ' "$file" >"$file.tmp"
  mv "$file.tmp" "$file"
}

stage_semantic_model() {
  local staged_root="$WORK_DIR/deploy-source"
  local staged_item="$staged_root/$FABRIC_SEMANTIC_MODEL_NAME.SemanticModel"
  local source_expression restock_expression table_file

  rm -rf "$staged_root"
  mkdir -p "$staged_item"
  cp -R "$MODEL_SOURCE_DIR/." "$staged_item/"

  if [[ "$FABRIC_MODEL_STORAGE_MODE" == "onelake" ]]; then
    source_expression="AzureStorage.DataLake(\"https://onelake.dfs.fabric.microsoft.com/$WORKSPACE_ID/$LAKEHOUSE_ID\")"
  else
    [[ -n "$SQL_ENDPOINT_CONNECTION_STRING" ]] || die "SQL storage mode needs a SQL endpoint connection string."
    source_expression="Sql.Database(\"$SQL_ENDPOINT_CONNECTION_STRING\", \"$SQL_ENDPOINT_ID\")"
  fi

  # Reorders are written by the Rayfin app into its own Fabric SQL database, which
  # Fabric mirrors into OneLake as Delta. Direct Lake reads that copy, so the model and
  # the app never disagree about what was ordered.
  [[ -n "$RAYFIN_SQL_DATABASE_ID" ]] || die "RAYFIN_SQL_DATABASE_ID is not set. Deploy the Rayfin app with 'npx rayfin up' and copy its SQL database id into .env."
  restock_expression="AzureStorage.DataLake(\"https://onelake.dfs.fabric.microsoft.com/$WORKSPACE_ID/$RAYFIN_SQL_DATABASE_ID\")"

  replace_token "$staged_item/definition/model.tmdl" "$DATABASE_QUERY_TOKEN" "$source_expression"
  replace_token "$staged_item/definition/model.tmdl" "$RESTOCK_QUERY_TOKEN" "$restock_expression"
  replace_token "$staged_item/.platform" "caldova-operations" "$FABRIC_SEMANTIC_MODEL_NAME"

  # A SQL-endpoint binding addresses tables through a schema; a schema-less lakehouse
  # read straight from OneLake does not have one. RestockRequests is skipped: it reads
  # the Rayfin SQL database, whose mirrored tables always sit under a dbo schema, so it
  # carries its own schemaName already.
  if [[ "$FABRIC_MODEL_STORAGE_MODE" == "sql" ]]; then
    for table_file in "$staged_item"/definition/tables/*.tmdl; do
      [[ "$(basename "$table_file")" == "RestockRequests.tmdl" ]] && continue
      awk '{ print; if ($0 ~ /entityName: /) print "\t\t\tschemaName: dbo" }' "$table_file" >"$table_file.tmp"
      mv "$table_file.tmp" "$table_file"
    done
  fi

  printf '%s' "$staged_root"
}

deploy_semantic_model() {
  local staged_root item_ref plan_errors delete_count foreign_count
  staged_root="$(stage_semantic_model)"
  item_ref="$FABRIC_SEMANTIC_MODEL_NAME.SemanticModel"

  log "Validating the staged model definition"
  fabio_json deploy validate --source "$staged_root" >/dev/null \
    || die "The staged semantic model definition is not valid."

  log "Planning the deployment of '$FABRIC_SEMANTIC_MODEL_NAME'"
  plan_errors="$(fabio_value "length(errors)" deploy plan --source "$staged_root" --workspace "$WORKSPACE_ID" --include-items "$item_ref")"
  [[ "${plan_errors:-0}" == "0" ]] || die "The deployment plan reported $plan_errors error(s). Run 'fabio deploy plan' by hand to see them."

  delete_count="$(fabio_value "length(changes[?action=='Delete'])" deploy plan --source "$staged_root" --workspace "$WORKSPACE_ID" --include-items "$item_ref")"
  [[ "${delete_count:-0}" == "0" ]] || die "The deployment plan wants to delete $delete_count item(s). Refusing to apply it."

  foreign_count="$(fabio_value "length(changes[?item_type!='SemanticModel'])" deploy plan --source "$staged_root" --workspace "$WORKSPACE_ID" --include-items "$item_ref")"
  [[ "${foreign_count:-0}" == "0" ]] || die "The deployment plan touches $foreign_count non-semantic-model item(s). Refusing to apply it."

  log "Applying the deployment"
  fabio_json deploy apply --source "$staged_root" --workspace "$WORKSPACE_ID" --include-items "$item_ref" --no-post-hooks >/dev/null \
    || die "Deploying the semantic model failed."

  SEMANTIC_MODEL_ID="$(fabio_value "[?displayName=='$FABRIC_SEMANTIC_MODEL_NAME'].id | [0]" semantic-model list --workspace "$WORKSPACE_ID" --all)"
  [[ -n "$SEMANTIC_MODEL_ID" ]] || die "The semantic model was deployed but could not be found by name."
  log "Semantic model $SEMANTIC_MODEL_ID deployed"
}

refresh_semantic_model() {
  log "Refreshing the model to frame Direct Lake"
  if fabio_json semantic-model refresh --workspace "$WORKSPACE_ID" --id "$SEMANTIC_MODEL_ID" >/dev/null 2>&1; then
    return 0
  fi
  # Creating the model already kicks off a framing refresh, and Fabric rejects a
  # second one while it runs. The smoke query below is what actually proves the
  # model is ready, so waiting for the in-flight refresh is enough.
  log "A refresh is already running; waiting for that one instead."
}

run_smoke_test() {
  local attempt=1
  local output=""

  log "Running the smoke query"
  while (( attempt <= 10 )); do
    if output="$(fabio_json semantic-model query --workspace "$WORKSPACE_ID" --id "$SEMANTIC_MODEL_ID" --file "$DAX_DIR/smoke-test.dax" 2>/dev/null)"; then
      log "Smoke query succeeded:"
      printf '%s\n' "$output"
      return 0
    fi
    log "The model is not answering queries yet (attempt $attempt/10); waiting 15s"
    sleep 15
    attempt=$((attempt + 1))
  done

  die "The model did not answer the smoke query. Try 'fabio semantic-model query --file $DAX_DIR/smoke-test.dax' by hand."
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

set_env_value() {
  local key="$1" value="$2"
  local tmp="$WORK_DIR/env.tmp"

  mkdir -p "$WORK_DIR"
  awk -v key="$key" -v value="$value" '
    BEGIN { seen = 0 }
    {
      if ($0 ~ "^" key "=") {
        if (!seen) { print key "=" value; seen = 1 }
      } else {
        print
      }
    }
    END { if (!seen) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}

write_state() {
  log "Writing the resolved ids back to .env"
  set_env_value FABRIC_WORKSPACE_ID "$WORKSPACE_ID"
  [[ -n "$LAKEHOUSE_ID" ]] && set_env_value FABRIC_LAKEHOUSE_ID "$LAKEHOUSE_ID"
  [[ -n "$SQL_ENDPOINT_ID" ]] && set_env_value FABRIC_SQL_ENDPOINT_ID "$SQL_ENDPOINT_ID"
  [[ -n "$SEMANTIC_MODEL_ID" ]] && set_env_value FABRIC_SEMANTIC_MODEL_ID "$SEMANTIC_MODEL_ID"
  return 0
}

print_summary() {
  local workspace_url lakehouse_url model_url

  workspace_url="$(fabio_value "url" workspace url --id "$WORKSPACE_ID")"
  lakehouse_url="$(fabio_value "url" item url --workspace "$WORKSPACE_ID" --id "$LAKEHOUSE_ID" --type Lakehouse)"
  model_url="$(fabio_value "url" item url --workspace "$WORKSPACE_ID" --id "$SEMANTIC_MODEL_ID" --type SemanticModel)"

  printf '\n'
  log "Done."
  log "Workspace:      $WORKSPACE_ID${workspace_url:+  $workspace_url}"
  log "Lakehouse:      $LAKEHOUSE_ID${lakehouse_url:+  $lakehouse_url}"
  log "SQL endpoint:   $SQL_ENDPOINT_ID"
  log "Semantic model: $SEMANTIC_MODEL_ID${model_url:+  $model_url}"
  log "Storage mode:   $FABRIC_MODEL_STORAGE_MODE"
}

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

run_reset() {
  local model_id lakehouse_id

  resolve_workspace

  model_id="$(fabio_value "[?displayName=='$FABRIC_SEMANTIC_MODEL_NAME'].id | [0]" semantic-model list --workspace "$WORKSPACE_ID" --all)"
  if [[ -n "$model_id" ]]; then
    log "Deleting semantic model '$FABRIC_SEMANTIC_MODEL_NAME' ($model_id)"
    fabio_json semantic-model delete --workspace "$WORKSPACE_ID" --id "$model_id" --force >/dev/null
  else
    log "No semantic model named '$FABRIC_SEMANTIC_MODEL_NAME' to delete"
  fi

  lakehouse_id="$(fabio_value "[?displayName=='$FABRIC_LAKEHOUSE_NAME'].id | [0]" lakehouse list --workspace "$WORKSPACE_ID" --all)"
  if [[ -n "$lakehouse_id" ]]; then
    log "Deleting lakehouse '$FABRIC_LAKEHOUSE_NAME' ($lakehouse_id)"
    fabio_json lakehouse delete --workspace "$WORKSPACE_ID" --id "$lakehouse_id" --force >/dev/null
  else
    log "No lakehouse named '$FABRIC_LAKEHOUSE_NAME' to delete"
  fi

  set_env_value FABRIC_LAKEHOUSE_ID ""
  set_env_value FABRIC_SQL_ENDPOINT_ID ""
  set_env_value FABRIC_SEMANTIC_MODEL_ID ""

  log "Reset complete. The workspace itself was left alone."
}

# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------

print_dry_run() {
  local spec table file staged_root

  log "Dry run. Nothing is sent to Fabric and no files are changed."
  log "Workspace:      ${FABRIC_WORKSPACE_ID:-by name '$FABRIC_WORKSPACE_NAME'}"
  log "Lakehouse:      $FABRIC_LAKEHOUSE_NAME"
  log "Semantic model: $FABRIC_SEMANTIC_MODEL_NAME"
  log "Storage mode:   $FABRIC_MODEL_STORAGE_MODE"

  check_dataset_files
  log "All four dataset CSVs are present in data/generated"

  WORKSPACE_ID="00000000-0000-0000-0000-000000000000"
  LAKEHOUSE_ID="11111111-1111-1111-1111-111111111111"
  SQL_ENDPOINT_ID="22222222-2222-2222-2222-222222222222"
  SQL_ENDPOINT_CONNECTION_STRING="example.datawarehouse.fabric.microsoft.com"
  staged_root="$(stage_semantic_model)"

  if fabio_json deploy validate --source "$staged_root" >/dev/null 2>&1; then
    log "The staged semantic model definition is valid"
  else
    die "The staged semantic model definition is not valid. Run: fabio deploy validate --source $staged_root"
  fi
  printf '\n'

  if (( RESET_ONLY )); then
    log "Reset would delete only these, and would leave the workspace in place:"
    preview "semantic-model delete --workspace <workspace> --name $FABRIC_SEMANTIC_MODEL_NAME"
    preview "lakehouse delete --workspace <workspace> --name $FABRIC_LAKEHOUSE_NAME"
    return 0
  fi

  preview "auth status"
  if [[ -n "$FABRIC_WORKSPACE_ID" ]]; then
    preview "workspace show --id $FABRIC_WORKSPACE_ID"
  else
    preview "workspace list --all"
  fi
  [[ -n "$FABRIC_CAPACITY_ID" ]] && preview "workspace assign-capacity --id <workspace> --capacity $FABRIC_CAPACITY_ID"
  preview "lakehouse list --workspace <workspace> --all"
  preview "lakehouse create --workspace <workspace> --name $FABRIC_LAKEHOUSE_NAME"
  preview "lakehouse show --workspace <workspace> --id <lakehouse>"

  if (( SKIP_DATA )); then
    log "would skip the data load because --skip-data was given"
  else
    for spec in $TABLE_SPECS; do
      table="${spec%%:*}"
      file="${spec##*:}"
      preview "lakehouse upload-table --workspace <workspace> --id <lakehouse> --source-path data/generated/$file --table $table --mode Overwrite --format Csv"
    done
    preview "sql-endpoint refresh-metadata --workspace <workspace> --id <sql-endpoint>"
    preview "lakehouse list-tables --workspace <workspace> --id <lakehouse> --all"
    preview "sql-endpoint query --workspace <workspace> --id <rayfin-sql-endpoint> --sql <RestockRequests schema>"
  fi

  preview "deploy validate --source <staged model>"
  preview "deploy plan --source <staged model> --workspace <workspace> --include-items $FABRIC_SEMANTIC_MODEL_NAME.SemanticModel"
  preview "deploy apply --source <staged model> --workspace <workspace> --include-items $FABRIC_SEMANTIC_MODEL_NAME.SemanticModel --no-post-hooks"
  preview "semantic-model list --workspace <workspace> --all"
  preview "semantic-model refresh --workspace <workspace> --id <model>"
  preview "semantic-model query --workspace <workspace> --id <model> --file fabric/dax/smoke-test.dax"
}

# ---------------------------------------------------------------------------

parse_args() {
  while (($#)); do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      --reset) RESET_ONLY=1; shift ;;
      --skip-generate) SKIP_GENERATE=1; shift ;;
      --skip-data) SKIP_DATA=1; shift ;;
      --capacity)
        [[ $# -ge 2 ]] || die "--capacity needs a capacity id"
        CAPACITY_OVERRIDE="$2"
        shift 2
        ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

main() {
  parse_args "$@"
  load_env_file
  apply_config_defaults
  check_prerequisites
  mkdir -p "$WORK_DIR"

  if (( DRY_RUN )); then
    print_dry_run
    return 0
  fi

  check_authentication

  if (( RESET_ONLY )); then
    run_reset
    return 0
  fi

  resolve_workspace
  assign_capacity
  resolve_or_create_lakehouse

  if (( SKIP_DATA )); then
    log "Skipping the data load because --skip-data was given"
  else
    generate_dataset
    upload_tables
    verify_tables
    report_restock_schema
    seed_restock_requests
  fi

  deploy_semantic_model
  refresh_semantic_model
  run_smoke_test
  write_state
  print_summary
}

main "$@"
