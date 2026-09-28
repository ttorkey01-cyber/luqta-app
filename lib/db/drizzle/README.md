# Hunt schema migration baseline

`0000_green_secret_warriors.sql` was generated offline from the current Drizzle
schema. It creates the five Hunt tables from an empty database.

The development database already contains these tables from schema pushes, but
does not have a Drizzle migration journal recording this migration. Do **not**
run this initial migration against the existing development or production
database: its `CREATE TABLE` statements would conflict with existing tables.
No migration has been applied as part of creating these files.

Replit's managed Publish flow compares the development and production database
schemas independently of this Drizzle journal. Checking in this baseline alone
does not prove or repair the reported Publish migration-validation failure.
Establish a safe baseline strategy for any existing database before switching
from schema push to `drizzle-kit migrate`.