# AI EXECUTION CHECKLIST

> This file is for the AI that will execute the project in SERVER_MASTERY_PROJECT.md.
> Read SERVER_MASTERY_PROJECT.md first for full context, then follow these steps in order.
> Every step has a verification check. Do not proceed until the check passes.

## Rules for the executing AI
- Every file you create must have inline comments explaining what each line does
- Never skip steps or combine steps — do them in order
- After every step, verify it works before moving to the next
- If something fails, debug it before continuing
- Commit after each major phase with a descriptive commit message
- If you encounter an error you cannot resolve, STOP and report the error with full context

---

## Phase 1: Server Fundamentals

### Step 1.1: Scaffold the Worker
- [ ] Run `npm create cloudflare@latest api-gateway -- --type hello-world` from repo root
- [ ] Run `cd api-gateway && npm install`
- [ ] Verify: `npm run dev` starts, opens http://localhost:8787
- [ ] Verify: Browser shows "Hello World!"
- [ ] Stop the dev server

### Step 1.2: Create env.ts
- [ ] Create `api-gateway/src/env.ts` with the Env type and validateEnv function
- [ ] File contains: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWT_SECRET, ENVIRONMENT

### Step 1.3: Create supabase.ts
- [ ] Install `@supabase/supabase-js` in api-gateway
- [ ] Create `api-gateway/src/supabase.ts` with createSupabaseClient function
- [ ] It imports validateEnv from env.ts

### Step 1.4: Set up secrets
- [ ] Update `wrangler.toml` with SUPABASE_URL and ENVIRONMENT
- [ ] Run `npx wrangler secret put SUPABASE_SECRET_KEY` and paste the real key
- [ ] Run `npx wrangler secret put SUPABASE_JWT_SECRET` and paste the real JWT secret

### Step 1.5: Create routes/rides.ts
- [ ] Create `api-gateway/src/routes/rides.ts` with all five functions:
  - [ ] handleGetRides
  - [ ] handleGetRide
  - [ ] handleCreateRide
  - [ ] handleUpdateRide
  - [ ] handleDeleteRide
- [ ] Each function has full inline comments
- [ ] Each function has error handling (try/catch)

### Step 1.6: Build the router
- [ ] Replace `api-gateway/src/index.ts` with full router
- [ ] Router handles: GET /api/health, GET /api/rides, GET /api/rides/:id, POST /api/rides, PUT /api/rides/:id, DELETE /api/rides/:id
- [ ] Router includes CORS headers and OPTIONS handling
- [ ] Router includes 404 catch-all

### Step 1.7: Test all endpoints
- [ ] Start dev server: `cd api-gateway && npm run dev`
- [ ] Test: `curl http://localhost:8787/api/health` → 200 with status ok
- [ ] Test: `curl http://localhost:8787/api/rides` → 200 with empty rides
- [ ] Test: `curl -X POST http://localhost:8787/api/rides -H "Content-Type: application/json" -d '{"name":"Test"}'` → 201 with ride data
- [ ] Test: `curl http://localhost:8787/api/rides/<id>` → 200 with ride data
- [ ] Test: `curl -X DELETE http://localhost:8787/api/rides/<id>` → 204
- [ ] Stop dev server

### Step 1.8: Commit
- [ ] `git add api-gateway/`
- [ ] `git commit -m "feat: add API gateway with ride CRUD endpoints"`

---

## Phase 2: Authentication

### Step 2.1: Install JWT library
- [ ] `cd api-gateway && npm install jose`

### Step 2.2: Create auth/verify.ts
- [ ] Create `api-gateway/src/auth/verify.ts`
- [ ] Function: verifySupabaseJwt(token, jwtSecret)
- [ ] Returns JwtPayload or null
- [ ] Full inline comments explaining JWT verification

### Step 2.3: Create middleware/auth.ts
- [ ] Create `api-gateway/src/middleware/auth.ts`
- [ ] Function: requireAuth(request, env) → AuthenticatedUser | Response
- [ ] Function: requireAdmin(request, env) → AuthenticatedUser | Response
- [ ] Full inline comments explaining the middleware pattern

### Step 2.4: Wire auth into router
- [ ] Import requireAdmin in index.ts
- [ ] POST /api/rides requires admin
- [ ] PUT /api/rides/:id requires admin
- [ ] DELETE /api/rides/:id requires admin
- [ ] GET endpoints remain public

### Step 2.5: Update handleCreateRide
- [ ] Add createdByUserId parameter
- [ ] Use it instead of the placeholder UUID

### Step 2.6: Test auth
- [ ] Start dev server
- [ ] Test: POST without auth → 401
- [ ] Test: POST with fake token → 401
- [ ] Test: GET without auth → 200 (still public)
- [ ] Stop dev server

### Step 2.7: Commit
- [ ] `git commit -m "feat: add JWT authentication and auth middleware"`

---

## Phase 3: Database

### Step 3.1: Create migration
- [ ] Create `supabase/migrations/20260813120000_add_api_logs.sql`
- [ ] Table: api_logs with all columns
- [ ] Indexes: idx_api_logs_created_at, idx_api_logs_user_id, idx_api_logs_path_status
- [ ] RLS: admins can read, service_role can insert

### Step 3.2: Apply migration
- [ ] Run `supabase db reset` from repo root
- [ ] Verify: migration applied without errors

### Step 3.3: Create middleware/logging.ts
- [ ] Create `api-gateway/src/middleware/logging.ts`
- [ ] Function: logRequest(request, statusCode, env, userId?, startTime?)
- [ ] Fire-and-forget pattern (doesn't block the response)

### Step 3.4: Wire logging into router
- [ ] Import logRequest in index.ts
- [ ] Track startTime at the start of fetch()
- [ ] Call ctx.waitUntil(logRequest(...)) after response is determined

### Step 3.5: Test logging
- [ ] Start dev server
- [ ] Make a request
- [ ] Check terminal for log output: "GET /api/rides → 200 (Xms)"
- [ ] Verify api_logs table has entries in Supabase Studio

### Step 3.6: Commit
- [ ] `git commit -m "feat: add API request logging with indexed database table"`

---

## Phase 4: Error Handling

### Step 4.1: Create errors.ts
- [ ] Create `api-gateway/src/errors.ts`
- [ ] Class: ApiError with statusCode, code, message, details
- [ ] Pre-defined errors: badRequest, unauthorized, forbidden, notFound, conflict, internalError, rateLimited

### Step 4.2: Create middleware/rateLimit.ts
- [ ] Create `api-gateway/src/middleware/rateLimit.ts`
- [ ] Function: checkRateLimit(request, corsHeaders) → Response | null
- [ ] In-memory store with 1-minute windows, 100 requests per window
- [ ] Auto-cleanup of old entries

### Step 4.3: Wire rate limiting into router
- [ ] Import checkRateLimit in index.ts
- [ ] Check rate limit before route matching
- [ ] Return 429 with Retry-After header if exceeded

### Step 4.4: Test rate limiting
- [ ] Start dev server
- [ ] Make 101 requests quickly
- [ ] Verify: request 102 returns 429

### Step 4.5: Commit
- [ ] `git commit -m "feat: add structured error handling and rate limiting"`

---

## Phase 5: WebSockets

### Step 5.1: Create realtime/rooms.ts
- [ ] Create `api-gateway/src/realtime/rooms.ts`
- [ ] Functions: joinRideRoom, leaveRideRoom, broadcastToRoom, getRoomSize
- [ ] In-memory Map storage with auto-cleanup

### Step 5.2: Create routes/realtime.ts
- [ ] Create `api-gateway/src/routes/realtime.ts`
- [ ] Function: handleWebSocketUpgrade(request) → Response
- [ ] Handles: join_ride, position_update, ping messages
- [ ] Handles: close event (cleanup)

### Step 5.3: Wire WebSocket into router
- [ ] Import handleWebSocketUpgrade in index.ts
- [ ] Route: /api/realtime → handleWebSocketUpgrade

### Step 5.4: Commit
- [ ] `git commit -m "feat: add WebSocket real-time communication"`

---

## Phase 6: Docker

### Step 6.1: Create Dockerfile
- [ ] Create `api-gateway/Dockerfile`
- [ ] Multi-stage: builder stage + runner stage
- [ ] Builder: npm ci --include=dev, build, test
- [ ] Runner: npm ci --omit=dev, CMD node dist/index.js

### Step 6.2: Create .dockerignore
- [ ] Create `api-gateway/.dockerignore`
- [ ] Excludes: node_modules, dist, .env*, .git

### Step 6.3: Create docker-compose.dev.yml
- [ ] Create `docker-compose.dev.yml` at repo root
- [ ] Service: api-gateway
- [ ] Ports: 8787:8787
- [ ] Environment: SUPABASE_URL, secrets, ENVIRONMENT
- [ ] Volumes: ./api-gateway/src:/app/src

### Step 6.4: Test Docker
- [ ] `docker compose -f docker-compose.dev.yml up --build`
- [ ] Test: `curl http://localhost:8787/api/health` → 200
- [ ] `docker compose -f docker-compose.dev.yml down`

### Step 6.5: Commit
- [ ] `git commit -m "feat: add Docker multi-stage build and compose config"`

---

## Phase 7: CI/CD

### Step 7.1: Create workflow
- [ ] Create `.github/workflows/deploy-api.yml`
- [ ] Trigger: push to main, paths: api-gateway/**
- [ ] Steps: checkout, setup-node, npm ci, type-check, test, deploy
- [ ] Uses CLOUDFLARE_API_TOKEN secret

### Step 7.2: Create GitHub secret
- [ ] Go to GitHub repo → Settings → Secrets → Actions
- [ ] Add CLOUDFLARE_API_TOKEN

### Step 7.3: Commit
- [ ] `git commit -m "feat: add CI/CD pipeline for API gateway deployment"`

---

## Phase 8: Nginx (Reference)

### Step 8.1: Create nginx.conf
- [ ] Create `nginx/nginx.conf`
- [ ] Rate limiting, upstream, static files, API proxy, WebSocket proxy
- [ ] This is reference only, not used by Cloudflare Workers

### Step 8.2: Commit
- [ ] `git commit -m "docs: add Nginx reverse proxy reference configuration"`

---

## Phase 9: Testing

### Step 9.1: Set up vitest
- [ ] `cd api-gateway && npm install -D vitest`
- [ ] Add test script to package.json

### Step 9.2: Write unit tests
- [ ] Create `api-gateway/src/__tests__/rides.test.ts`
- [ ] Mock Supabase client
- [ ] Test handleGetRides success and error cases

### Step 9.3: Run tests
- [ ] `cd api-gateway && npm test`
- [ ] All tests pass

### Step 9.4: Commit
- [ ] `git commit -m "test: add unit tests for ride endpoints"`

---

## Phase 10: Wire Frontend

### Step 10.1: Create api.ts adapter
- [ ] Create `src/core/adapters/api.ts`
- [ ] Functions: fetchRidesFromApi, fetchRideFromApi, createRideViaApi
- [ ] Uses VITE_API_URL environment variable

### Step 10.2: Update .env.local
- [ ] Add `VITE_API_URL=http://localhost:8787`

### Step 10.3: Test full flow
- [ ] Start Supabase: `supabase start`
- [ ] Start API: `cd api-gateway && npm run dev`
- [ ] Start frontend: `npm run dev`
- [ ] Open browser, verify the app loads and fetches rides from the API

### Step 10.4: Commit
- [ ] `git commit -m "feat: wire frontend to use API gateway"`

---

## Final Verification

- [ ] All 10 phases complete
- [ ] All tests passing (`npm test` in api-gateway)
- [ ] Type checking passes (`npx tsc --noEmit` in api-gateway)
- [ ] Frontend loads and communicates with the API
- [ ] API responds to all endpoints
- [ ] WebSocket connects (check browser DevTools → Network → WS)
- [ ] Docker container builds and runs
- [ ] Git log shows 10+ descriptive commits
