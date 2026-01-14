# Test Deploy

Proyecto Node.js dockerizado con CI/CD automatizado usando GitHub Actions.

## Arquitectura

```mermaid
graph TB
    subgraph "GitHub"
        REPO[Repositorio]
        ACTIONS[GitHub Actions]
        GHCR[GitHub Container Registry]
    end

    subgraph "Servidor"
        TRAEFIK[Traefik]
        DOCKER[Docker Compose]
        APP[App Node.js]
    end

    REPO -->|push a main| ACTIONS
    ACTIONS -->|build & push| GHCR
    ACTIONS -->|SSH deploy| DOCKER
    GHCR -->|pull image| DOCKER
    DOCKER --> APP
    TRAEFIK -->|proxy| APP

    INTERNET[Internet] -->|HTTPS| TRAEFIK
```

## Flujo de Deploy

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant GH as GitHub
    participant GA as GitHub Actions
    participant GHCR as Container Registry
    participant SRV as Servidor

    DEV->>GH: Push a main (nueva version)
    GH->>GA: Trigger workflow

    GA->>GA: Crear tag automatico (vX.X.X)
    GA->>GA: Build imagen Docker
    GA->>GHCR: Push imagen (:main, :version, :sha)

    GA->>SRV: SSH conexion
    SRV->>SRV: git pull
    SRV->>GHCR: docker compose pull
    SRV->>SRV: docker compose up -d
    SRV->>SRV: Health check

    GA-->>DEV: Deploy exitoso/fallido
```

## Flujo de Rollback

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant GA as GitHub Actions
    participant GHCR as Container Registry
    participant SRV as Servidor

    DEV->>GA: Ejecutar workflow rollback (version X.X.X)

    GA->>GA: Validar que el tag existe
    GA->>SRV: SSH conexion
    SRV->>SRV: Cambiar imagen en docker-compose.yml
    SRV->>GHCR: docker compose pull (version especifica)
    SRV->>SRV: docker compose up -d --force-recreate
    SRV->>SRV: Health check

    GA-->>DEV: Rollback exitoso/fallido
```

## Flujo de Pull Request

```mermaid
flowchart TD
    A[Crear rama] --> B[Cambiar version en package.json]
    B --> C[Push rama]
    C --> D[Crear PR a main]
    D --> E{Validaciones}

    E -->|check-version| F{Version diferente a main?}
    E -->|security-audit| G{npm audit OK?}

    F -->|No| H[PR Bloqueado]
    F -->|Si| I{Tag ya existe?}

    I -->|Si| H
    I -->|No| J[Check passed]

    G -->|Vulnerabilidades HIGH/CRITICAL| H
    G -->|OK| K[Check passed]

    J --> L{Todos los checks OK?}
    K --> L

    L -->|Si| M[Merge permitido]
    L -->|No| H

    M --> N[Deploy automatico]
```

## Estructura del Proyecto

```
test-deploy/
├── .github/
│   └── workflows/
│       ├── deploy.yml          # Deploy automatico
│       ├── rollback.yml        # Rollback manual
│       └── validate-version.yml # Validacion en PRs
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── index.js                    # Servidor Express
├── package.json
└── README.md
```

## Endpoints

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/` | GET | Mensaje de bienvenida con timestamp |
| `/health` | GET | Health check con version de la app |

## Workflows

### Deploy (deploy.yml)

Se ejecuta en push a main:

1. **create-tag**: Crea tag automatico basado en `package.json`
2. **build-and-push**: Construye y sube imagen a ghcr.io
3. **deploy**: Despliega en el servidor via SSH

```mermaid
graph LR
    A[Push a main] --> B[create-tag]
    B --> C[build-and-push]
    C --> D[deploy]
    D --> E[Health check]
```

### Rollback (rollback.yml)

Se ejecuta manualmente desde GitHub Actions:

1. Seleccionar version a desplegar
2. Valida que el tag exista
3. Cambia imagen en el servidor
4. Verifica health check

### Validate Version (validate-version.yml)

Se ejecuta en PRs a main:

1. **check-version**: Valida que la version sea diferente y el tag no exista
2. **security-audit**: Ejecuta `npm audit`

## Imagenes Docker

Cada build crea tres tags en ghcr.io:

| Tag | Descripcion |
|-----|-------------|
| `:main` | Ultima version de main |
| `:X.X.X` | Version especifica (para rollback) |
| `:<sha>` | Commit especifico |

## Seguridad

- **npm audit**: Escaneo de vulnerabilidades en dependencias
- **Trivy**: Escaneo de vulnerabilidades en imagen Docker
- **Docker no-root**: Contenedor ejecuta como usuario `nodejs`
- **Versiones fijadas**: GitHub Actions usan versiones especificas

## Como usar

### Deploy nueva version

```bash
# 1. Actualizar version en package.json
# 2. Commit y push
git add -A
git commit -m "Bump version to X.X.X"
git push origin main
```

### Rollback

1. Ir a [Actions > Rollback](../../actions/workflows/rollback.yml)
2. Click "Run workflow"
3. Ingresar version (ej: `1.0.8`)
4. Click "Run workflow"

### Ver versiones disponibles

- [GitHub Packages](../../pkgs/container/test-deploy)

## Configuracion

### Secrets requeridos

| Secret | Descripcion |
|--------|-------------|
| `SERVER_HOST` | IP o dominio del servidor |
| `SERVER_USER` | Usuario SSH |
| `SSH_PRIVATE_KEY` | Llave privada SSH |

### Proteccion de rama

Configurar en Settings > Branches > main:

- Require pull request before merging
- Require status checks: `check-version`, `security-audit`
- Do not allow bypassing the above settings

## Tecnologias

- **Runtime**: Node.js 20 Alpine
- **Framework**: Express
- **Contenedor**: Docker + Docker Compose
- **Proxy**: Traefik v3
- **CI/CD**: GitHub Actions
- **Registry**: GitHub Container Registry (ghcr.io)
