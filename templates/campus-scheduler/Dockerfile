# Campus-Scheduler backend: FastAPI + CP-SAT + the Foundry agent loop.
#
# The generated dataset is COPIED INTO the image on purpose. It is ~4 MB of JSON, it is the thing
# the tools answer from, and baking it in means the container has no start-up dependency on
# storage, a lakehouse or a network share. When the data changes, the image changes — which is
# also the honest way to version an answer a planner might quote.

FROM python:3.12-slim

WORKDIR /app

# Dependencies first, so a data or code change does not re-resolve ortools (which is large).
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/
# ⚠️ THE DATASETS, AND `.dockerignore` IS THE ONE PLACE THAT DECIDES WHICH. `SCHEDULER_SITE` picks
# between them at start-up, so the image is identical for every university and the only difference
# between the deployments is one variable.
#
# This used to be one `COPY data/<site>/` line per site, with `.dockerignore` allowlisting the same
# set — two lists that had to agree, and did not: adding `!data/tum/` without its COPY made the
# directory available to the build context and never put it in the image, and the failure arrived
# as a startup probe failing 1 400 times with no replica left alive to read a log from.
#
# ⚠️ AND THE SECOND LIST COULD NOT BE MADE CORRECT FOR A PUBLIC CLONE. `data/tum/` is derived from
# TUMonline and `data/oth-real/` is OTH's own Untis export (see `config/release.json`), so neither
# can be produced by anyone who clones this repository — a COPY naming them is a build that can
# only fail, for a dataset that may not exist. Copying the directory and letting the allowlist
# decide leaves exactly one list. `tools/tests/test_sites_boot.py` still catches a site whose data
# is missing locally.
COPY data/ ./data/

ENV PORT=8080 \
    PYTHONUNBUFFERED=1
EXPOSE 8080

# `--app-dir server` matches how the module imports its siblings (schedule_store, tools, foundry)
# as top-level modules, which is also how it runs locally. Keeping the two identical means a
# working laptop run is evidence about the container.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --app-dir server"]
