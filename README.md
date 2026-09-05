## Quick setup (10 steps)

Follow these exact commands on a macOS machine to get the database, backend and frontend running.

1) Install system tooling (Homebrew + Node):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

2) Clone the repository and cd into it:

```bash
git clone <repo-url>
cd Loot-Locker
```

3) Install project dependencies:

```bash
npm install
```

4) Create a local env file from the example and edit it (DO NOT commit your secrets):

```bash
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL and DIRECT_URL. Example dev values:
# Homebrew Postgres (peer auth):
# DATABASE_URL="postgresql://$(whoami)@localhost:5432/lootlockers_dev?sslmode=disable"
# DIRECT_URL="postgresql://$(whoami)@localhost:5432/lootlockers_dev?sslmode=disable"
# OR Docker/Postgres with password:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
# DIRECT_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
```

5) Start Postgres (choose one):

- Homebrew Postgres:

```bash
brew install postgresql
brew services start postgresql
```

- Or Docker (start Docker Desktop first):

```bash
docker run -d --name lootlockers-postgres \
	-e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
	-e POSTGRES_DB=lootlockers_dev -p 5432:5432 postgres:15
```

6) Create the development database (if it doesn't exist):

```bash
# Using psql (Homebrew):
psql -c "CREATE DATABASE lootlockers_dev;" || true
# If psql is not available and you used Docker with user/postgres, the DB is created by the container above.
```

7) Generate the Prisma client:

```bash
# Ensure .env.local is sourced in the shell so prisma.config.ts can read DIRECT_URL when needed
set -a && source .env.local && set +a
npx prisma generate
```

8) Apply migrations, manual SQL constraints and seed the DB:

```bash
set -a && source .env.local && set +a
npm run db:setup
```

If the `psql` binary is not installed and the `npm run db:setup` step fails on the manual-constraints step, run the bundled Node helper instead:

```bash
set -a && source .env.local && set +a
node scripts/apply_constraints.js
npx prisma db seed
```

9) Start the development server:

```bash
npm run dev
```

10) Open the app in your browser:

```text
http://localhost:3000
```

Notes and common mistakes captured for automation agents:
- Always create `.env.local` from `.env.example` and never commit it.
- `prisma.config.ts` requires `DIRECT_URL`/`DATABASE_URL` at runtime for some CLI commands — source env before running `prisma` commands.
- If Docker commands fail, ensure Docker Desktop / dockerd is running.
- If `psql` is missing, use `scripts/apply_constraints.js` to apply manual SQL constraints.
- If you see `Cannot find module '.prisma/client/default'`, run `npx prisma generate` after setting a temporary `DATABASE_URL`.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Troubleshooting — Recent local changes

Below are the concise steps I performed while investigating a runtime error; the app still needs a running Postgres instance to finish setup.

1. Generated the Prisma client: ran `npx prisma generate` (used a temporary `DATABASE_URL` so the client was written to `node_modules/@prisma/client`).
2. Created `.env.local` from the project's `.env.example` and populated development values.
3. Updated `.env.local` to set explicit local DB credentials:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
```

4. Restarted the Next dev server — Next picks up `.env.local` and the generated Prisma client.
5. Attempted to start a local Postgres Docker container, but the Docker daemon on this machine was not running (so the container could not be created).
6. Current error: Prisma cannot connect to the database (ECONNREFUSED) because no Postgres server is listening on `localhost:5432`.
7. Recommended next steps (choose one):

	- Start Docker Desktop (or `dockerd`) and run:

		```bash
		docker pull postgres:15
		docker run -d --name lootlockers-postgres \
			-e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
			-e POSTGRES_DB=lootlockers_dev -p 5432:5432 postgres:15
		npm run db:setup
		npm run dev
		```

	- Or install Postgres locally (Homebrew) and create the `lootlockers_dev` database, then run:

		```bash
		brew install postgresql
		brew services start postgresql
		psql -c "CREATE DATABASE lootlockers_dev;"
		npm run db:setup
		npm run dev
		```

	- Or point `.env.local` to an accessible remote Postgres instance and run `npm run db:setup` there.

8. Notes and suggestions:
	- Consider adding a `postinstall` script to `package.json` to run `prisma generate` automatically after `npm install`.
	- I added a local `.env.local` to help development; do not commit secrets.

If you want, I can: add the `postinstall` script, attempt to start Docker (if you start Docker Desktop), or update `.env.local` to point at a remote DB — tell me which and I will proceed.

## Quick setup (10 steps)

Follow these exact commands on a macOS machine to get the database, backend and frontend running.

1) Install system tooling (Homebrew + Node):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

2) Clone the repository and cd into it:

```bash
git clone <repo-url>
cd Loot-Locker
```

3) Install project dependencies:

```bash
npm install
```

4) Create a local env file from the example and edit it (DO NOT commit your secrets):

```bash
cp .env.example .env.local
# Edit .env.local and set DATABASE_URL and DIRECT_URL. Example dev values:
# Homebrew Postgres (peer auth):
# DATABASE_URL="postgresql://$(whoami)@localhost:5432/lootlockers_dev?sslmode=disable"
# DIRECT_URL="postgresql://$(whoami)@localhost:5432/lootlockers_dev?sslmode=disable"
# OR Docker/Postgres with password:
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
# DIRECT_URL="postgresql://postgres:postgres@localhost:5432/lootlockers_dev?sslmode=disable"
```

5) Start Postgres (choose one):

- Homebrew Postgres:

```bash
brew install postgresql
brew services start postgresql
```

- Or Docker (start Docker Desktop first):

```bash
docker run -d --name lootlockers-postgres \
	-e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
	-e POSTGRES_DB=lootlockers_dev -p 5432:5432 postgres:15
```

6) Create the development database (if it doesn't exist):

```bash
# Using psql (Homebrew):
psql -c "CREATE DATABASE lootlockers_dev;" || true
# If psql is not available and you used Docker with user/postgres, the DB is created by the container above.
```

7) Generate the Prisma client:

```bash
# Ensure .env.local is sourced in the shell so prisma.config.ts can read DIRECT_URL when needed
set -a && source .env.local && set +a
npx prisma generate
```

8) Apply migrations, manual SQL constraints and seed the DB:

```bash
set -a && source .env.local && set +a
npm run db:setup
```

If the `psql` binary is not installed and the `npm run db:setup` step fails on the manual-constraints step, run the bundled Node helper instead:

```bash
set -a && source .env.local && set +a
node scripts/apply_constraints.js
npx prisma db seed
```

9) Start the development server:

```bash
npm run dev
```

10) Open the app in your browser:

```text
http://localhost:3000
```

Notes and common mistakes captured for automation agents:
- Always create `.env.local` from `.env.example` and never commit it.
- `prisma.config.ts` requires `DIRECT_URL`/`DATABASE_URL` at runtime for some CLI commands — source env before running `prisma` commands.
- If Docker commands fail, ensure Docker Desktop / dockerd is running.
- If `psql` is missing, use `scripts/apply_constraints.js` to apply manual SQL constraints.
- If you see `Cannot find module '.prisma/client/default'`, run `npx prisma generate` after setting a temporary `DATABASE_URL`.


