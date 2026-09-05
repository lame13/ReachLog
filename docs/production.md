# Production setup

Use [Configuration and hosting](configuration.md) for the public npm release.

ReachLog no longer assumes a particular hosting provider or deployment directory. Keep its database and configuration outside the application installation. Run the CLI using your existing process manager, and pass the same data directory and configuration file to scheduled workers.

Before moving an existing deployment, make a backup and set `DATABASE_PATH` to its existing database explicitly. Starting with the default data directory creates a separate empty database; it does not migrate files automatically.
