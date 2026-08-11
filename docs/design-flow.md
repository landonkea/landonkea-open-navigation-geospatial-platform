# Design flow

Required Phase 6 deliverable (see `workingTitle-BUILD-PROMPT.md`'s "Design
flow documentation" section): the full app workflow and every real branch
point, in Mermaid so it renders automatically on GitHub with no extra
tooling, consistent with this project's $0-forever rule.

## Rider join flow: link/QR to live map

```mermaid
flowchart TD
    Start([Rider opens a ride's join link or scans its QR code]) --> Lookup{Does the short slug match a real ride?}
    Lookup -->|No| NotFound[/Shown: "this ride link doesn't match any real ride"/]
    Lookup -->|Yes| Choice{"I'm riding" or "Just watching"?}

    Choice -->|Just watching| Spectator[Joined as spectator, no location ever requested]
    Choice -->|I'm riding| Permission{Browser location permission}

    Permission -->|Granted| Rider[Joined as rider, sharing live location]
    Permission -->|Denied / unavailable / timeout| Help[/Device-specific recovery instructions shown/]
    Help --> Retry{Retry location share}
    Retry -->|Granted| Rider
    Retry -->|Still fails / chooses "just watch"| Spectator

    Rider --> WakeLock[Screen wake lock requested]
    Rider --> Poll[Polling loop starts: POST own position + GET everyone's]
    Spectator --> PollWatch[Polling loop starts: GET everyone's positions only]

    Poll --> MapDraw[Map redraws: clustering, signal-color dots, route line/waypoints]
    PollWatch --> MapDraw
    MapDraw --> Roster[Roster panel available, same poll data, sorted by status]
```

## Admin ride creation flow

```mermaid
flowchart TD
    AdminStart([Admin opens /admin]) --> SignIn{Sign in with email + password}
    SignIn -->|Fails| SignInError[/Shown the real error/]
    SignIn -->|Succeeds| AdminCheck{Is this account in admin_roles?}
    AdminCheck -->|No| NotAdmin[/"Not on the admin list"/]
    AdminCheck -->|Yes| CreateForm[Create-ride form]

    CreateForm --> CreateRide[Ride created: status=active, short date-based slug generated]
    CreateRide --> ShowLink[Join link + QR code shown]
    ShowLink --> GpxChoice{Upload a GPX route file?}
    GpxChoice -->|No| NoRoute["No fixed route" ride, valid as-is]
    GpxChoice -->|Yes| ParseGpx{Valid GPX XML?}
    ParseGpx -->|No| GpxError[/"Doesn't look like a valid GPX file"/]
    ParseGpx -->|Yes| SaveRoute[Route line + waypoints saved, riders see it automatically]
```

## Ride lifecycle and data retention

```mermaid
flowchart LR
    Created[created] -->|admin publishes| Active[active: joinable, phones broadcasting]
    Active -->|admin ends it, or auto-end after N hours idle| Ended[ended]
    Ended -->|POST_RIDE_DISCONNECT_MINUTES elapses| Purged[Live position data deleted]
    Purged --> Sampled[Sparse historical trail retained, for future export]
```

## Where each external service gets called

```mermaid
flowchart TD
    App[This app, browser only, no custom backend server]
    App -->|Auth + Postgres REST, RLS-enforced| Supabase[(Supabase)]
    App -->|Map tiles, street view| OpenFreeMap[OpenFreeMap]
    App -->|Map tiles, satellite view| Esri[Esri World Imagery]
    GitHubActions[GitHub Actions] -->|keep-alive ping, not yet built| Supabase
    GitHubActions -->|build + deploy| GitHubPages[(GitHub Pages)]
    Cloudflare[Cloudflare Pages] -.git push auto-deploy.-> GitHubRepo[(GitHub repo)]
    GitHubActions -.git push auto-deploy.-> GitHubRepo
```
