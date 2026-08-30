import { COLUMN_MIGRATIONS, DROPPED_TABLES, SCHEMA_STATEMENTS } from "./schema";

// Separate SQLite database from zotero.sqlite, following the same pattern
// beaver-zotero uses (`new Zotero.DBConnection('beaver')`): Zotero creates/opens
// `zoteroEvidence.sqlite` in the profile's data directory automatically.
class DatabaseService {
  private conn: _ZoteroTypes.DBConnection | undefined;
  private initPromise: Promise<void> | undefined;

  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    this.conn = new Zotero.DBConnection("zoteroEvidence");
    await this.conn.executeTransaction(async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await this.conn!.queryAsync(statement);
      }
      for (const { table, column, definition } of COLUMN_MIGRATIONS) {
        const columns = (await this.conn!.queryAsync(
          `PRAGMA table_info(${table})`,
        )) as { name: string }[];
        if (!columns.some((c) => c.name === column)) {
          await this.conn!.queryAsync(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
          );
        }
      }
      for (const table of DROPPED_TABLES) {
        await this.conn!.queryAsync(`DROP TABLE IF EXISTS ${table}`);
      }
    });
  }

  private getConn(): _ZoteroTypes.DBConnection {
    if (!this.conn) {
      throw new Error("DatabaseService not initialized. Call init() first.");
    }
    return this.conn;
  }

  queryAsync(sql: string, params?: _ZoteroTypes.DB.QueryParams) {
    return this.getConn().queryAsync(sql, params);
  }

  valueQueryAsync<T = unknown>(
    sql: string,
    params?: _ZoteroTypes.DB.QueryParams,
  ) {
    return this.getConn().valueQueryAsync<T>(sql, params);
  }

  executeTransaction<T>(func: () => T | Promise<T>) {
    return this.getConn().executeTransaction(func);
  }

  async getLastInsertId(): Promise<number> {
    const id = await this.getConn().valueQueryAsync<number>(
      "SELECT last_insert_rowid()",
    );
    return Number(id);
  }
}

export const databaseService = new DatabaseService();
