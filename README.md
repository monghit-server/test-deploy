# Test Deploy

## Introduccion

Este proyecto es un **laboratorio de aprendizaje** para implementar un pipeline de CI/CD completo usando GitHub Actions, Docker y despliegue automatizado en un servidor remoto.

El objetivo fue construir desde cero un sistema que permita:
- Desplegar automaticamente al hacer push a main
- Versionar la aplicacion con tags de Git
- Realizar rollbacks a versiones anteriores
- Validar cambios antes de mergear a main
- Aplicar buenas practicas de seguridad
- Recibir notificaciones en Telegram cuando hay fallos

A lo largo del desarrollo se encontraron multiples problemas que fueron resueltos iterativamente, documentados en la seccion [Problemas Resueltos](#problemas-resueltos).

## Que se aprendio

### CI/CD con GitHub Actions
- Crear workflows que se disparan en push, tags y PRs
- Usar `workflow_dispatch` para ejecucion manual con parametros
- Encadenar jobs con dependencias (`needs`)
- Usar condicionales (`if`) para controlar ejecucion
- Pasar datos entre steps con `$GITHUB_OUTPUT`

### Docker y Container Registry
- Construir imagenes Docker optimizadas (Alpine, multi-stage)
- Publicar imagenes en GitHub Container Registry (ghcr.io)
- Crear multiples tags por imagen (version, sha, branch)
- Sistema de capas de Docker y como afecta el espacio
- Ejecutar contenedores como usuario no-root

### Git y Versionado
- Crear tags automaticamente desde workflows
- Proteger ramas con branch protection rules
- Validar versiones antes de permitir merge
- Configurar Git con diferentes usuarios por carpeta (`includeIf`)
- Configurar multiples llaves SSH por repositorio

### Despliegue y Operaciones
- Deploy via SSH desde GitHub Actions
- Integracion con Traefik como reverse proxy
- Health checks para verificar despliegues
- Rollback a versiones anteriores
- Limpieza de imagenes Docker no utilizadas

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

## Problemas Resueltos

### 1. SSH Key Verification Failed
**Problema**: Al clonar el repo desde el servidor, fallaba con "Host key verification failed".

**Causa**: El servidor no tenia configurada la llave SSH para GitHub.

**Solucion**: Cambiar de SSH a HTTPS para el clone:
```bash
# Antes (fallaba)
git clone git@github.com:user/repo.git

# Despues (funciona)
git clone https://github.com/user/repo.git
```

### 2. Permission Denied en Docker
**Problema**: `docker compose` fallaba con "permission denied" al socket de Docker.

**Causa**: El usuario SSH no estaba en el grupo `docker`.

**Solucion**: Agregar usuario al grupo docker en el servidor:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Health Check Fallaba con Contenedor Corriendo
**Problema**: El health check a `localhost:3000` fallaba aunque el contenedor estaba corriendo.

**Causa**: Con Traefik, el puerto 3000 no esta expuesto al host, solo accesible via la red de Docker.

**Solucion**: Cambiar health check para usar el dominio de Traefik:
```bash
# Antes (fallaba)
curl http://localhost:3000/health

# Despues (funciona)
curl https://test.monghit.com/health
```

### 4. Rollback No Cambiaba la Version
**Problema**: Despues de un rollback, el siguiente deploy restauraba la version anterior.

**Causa**: `git pull` no sobrescribe cambios locales en `docker-compose.yml`.

**Solucion**: Agregar reset del archivo antes del pull:
```bash
git checkout -- docker-compose.yml
git pull
```

### 5. Imagenes Versionadas No Se Creaban
**Problema**: Las imagenes con tag de version (`:1.0.5`) no existian en ghcr.io.

**Causa**: El tag de Git se creaba en el mismo workflow, pero GitHub no re-dispara el workflow para evitar loops.

**Solucion**: Crear los tags de imagen directamente en el build:
```yaml
tags: |
  ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:main
  ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.pkg_version.outputs.version }}
  ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
```

### 6. Rollback Fallaba en Imagenes Privadas
**Problema**: `docker compose pull` fallaba con "denied" al intentar descargar la imagen.

**Causa**: El workflow de rollback no hacia login a ghcr.io.

**Solucion**: Agregar login antes del pull:
```bash
echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
docker compose pull
```

### 7. Verificacion de Version Fallaba en Versiones Antiguas
**Problema**: El rollback a v1.0.0 fallaba la verificacion aunque el contenedor corria bien.

**Causa**: La v1.0.0 no tenia el campo `version` en el endpoint `/health`.

**Solucion**: Aceptar respuestas sin campo version:
```bash
if [ -z "$DEPLOYED_VERSION" ]; then
  echo "Version antigua sin info de version en /health"
  echo "Health check OK"
  exit 0
fi
```

### 8. Docker Compose Status Check Fallaba
**Problema**: `docker compose ps | grep -q "running"` fallaba aunque el contenedor estaba corriendo.

**Causa**: El formato de salida de `docker compose ps` cambio en versiones recientes.

**Solucion**: Confiar en el health check en lugar del grep:
```bash
# Antes (no confiable)
if ! docker compose ps | grep -q "running"; then

# Despues (confiable)
docker compose ps  # Solo informativo
# Confiar en el health check HTTP
```

## Estructura del Proyecto

```
test-deploy/
├── .github/
│   └── workflows/
│       ├── deploy.yml           # Deploy automatico en push a main
│       ├── rollback.yml         # Rollback manual a version especifica
│       └── validate-version.yml # Validacion de version en PRs
├── .dockerignore                # Excluir node_modules y .git
├── Dockerfile                   # Imagen Node.js Alpine con usuario no-root
├── docker-compose.yml           # Configuracion con labels de Traefik
├── index.js                     # Servidor Express con endpoints / y /health
├── package.json                 # Metadata y version de la app
└── README.md
```

## Endpoints

| Endpoint | Metodo | Respuesta |
|----------|--------|-----------|
| `/` | GET | `{"mensaje": "Hola desde GitHub Actions", "timestamp": "..."}` |
| `/health` | GET | `{"status": "ok", "app": "test-deploy", "version": "X.X.X"}` |

## Workflows

### Deploy (deploy.yml)

Se ejecuta en push a main:

1. **create-tag**: Crea tag automatico basado en `package.json`
2. **build-and-push**: Construye y sube imagen a ghcr.io
3. **deploy**: Despliega en el servidor via SSH

Cada job envia una notificacion a Telegram si falla.

```mermaid
graph LR
    A[Push a main] --> B[create-tag]
    B --> C[build-and-push]
    C --> D[deploy]
    D --> E[Health check]
    B -.->|fallo| T[Telegram]
    C -.->|fallo| T
    D -.->|fallo| T
```

### Rollback (rollback.yml)

Se ejecuta manualmente desde GitHub Actions:

1. Seleccionar version a desplegar (o dejar vacio para ver disponibles)
2. Valida que el tag exista
3. Cambia imagen en el servidor
4. Verifica health check

Envia notificacion a Telegram si falla cualquier paso.

### Validate Version (validate-version.yml)

Se ejecuta en PRs a main:

1. **check-version**: Valida que la version sea diferente y el tag no exista
2. **security-audit**: Ejecuta `npm audit`

## Imagenes Docker

Cada build crea tres tags en ghcr.io:

| Tag | Descripcion | Ejemplo |
|-----|-------------|---------|
| `:main` | Ultima version de main | `ghcr.io/user/repo:main` |
| `:X.X.X` | Version especifica | `ghcr.io/user/repo:1.0.10` |
| `:<sha>` | Commit especifico | `ghcr.io/user/repo:abc123` |

### Gestion de Imagenes

Las imagenes se almacenan en ghcr.io y se descargan al servidor en cada deploy. Para limpiar imagenes locales no utilizadas:

```bash
# Eliminar imagenes sin tag (dangling)
docker image prune -f

# Ver imagenes actuales
docker images
```

Las capas base de Docker son compartidas entre versiones, por lo que el espacio real utilizado es menor al mostrado.

## Seguridad

| Medida | Descripcion |
|--------|-------------|
| **npm audit** | Escaneo de vulnerabilidades en dependencias (HIGH/CRITICAL) |
| **Trivy** | Escaneo de vulnerabilidades en imagen Docker |
| **Docker no-root** | Contenedor ejecuta como usuario `nodejs` (UID 1001) |
| **Versiones fijadas** | GitHub Actions usan versiones especificas (no `@latest`) |
| **Branch protection** | PRs requeridos, checks obligatorios |

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
3. Ingresar version (ej: `1.0.8`) o dejar vacio para ver disponibles
4. Click "Run workflow"

### Ver versiones disponibles

- [GitHub Packages](../../pkgs/container/test-deploy)

## Notificaciones

Las notificaciones se envian a un webhook de n8n que las redirige a Telegram. Se activan cuando falla cualquier paso de los workflows.

### Eventos

| Evento | Workflow | Descripcion |
|--------|----------|-------------|
| `create_tag_failed` | deploy.yml | Fallo al crear el tag de version |
| `build_failed` | deploy.yml | Fallo al construir o subir la imagen Docker |
| `deploy_failed` | deploy.yml | Fallo al desplegar en el servidor |
| `rollback_failed` | rollback.yml | Fallo en cualquier paso del rollback |

### Formato del webhook

```json
{
  "event": "deploy_failed",
  "repository": "user/repo",
  "branch": "main",
  "commit": "abc123...",
  "version": "1.0.0",
  "actor": "username",
  "run_url": "https://github.com/user/repo/actions/runs/123"
}
```

## Configuracion

### Secrets requeridos

| Secret | Descripcion |
|--------|-------------|
| `SERVER_HOST` | IP o dominio del servidor |
| `SERVER_USER` | Usuario SSH |
| `SSH_PRIVATE_KEY` | Llave privada SSH |
| `TELEGRAM_WEBHOOK_URL` | URL del webhook de n8n para notificaciones a Telegram |

### Proteccion de rama

Configurar en Settings > Branches > main:

- Require pull request before merging
- Require status checks: `check-version`, `security-audit`
- Do not allow bypassing the above settings

### Configuracion Git local (opcional)

Para usar diferentes usuarios de Git por carpeta:

```bash
# ~/.gitconfig
[includeIf "gitdir:~/Git/personal/monghithub/"]
    path = ~/.gitconfig-monghit

# ~/.gitconfig-monghit
[user]
    name = usuario
    email = email@example.com
[core]
    sshCommand = ssh -i ~/.ssh/id_ed25519_github2 -o IdentitiesOnly=yes
```

## Tecnologias

| Categoria | Tecnologia |
|-----------|------------|
| **Runtime** | Node.js 20 Alpine |
| **Framework** | Express |
| **Contenedor** | Docker + Docker Compose |
| **Proxy** | Traefik v3 con Let's Encrypt |
| **CI/CD** | GitHub Actions |
| **Registry** | GitHub Container Registry (ghcr.io) |
| **Seguridad** | Trivy, npm audit |

## Licencia

MIT
