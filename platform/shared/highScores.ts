import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../server/data');

export interface PlatformHighScoreEntry {
  initials: string;
  name: string;
  score: number;
  stage: number;
  date: string;
}

export class PlatformHighScoreStore {
  private filePath: string;
  private entries: PlatformHighScoreEntry[] = [];

  constructor(gameId: string, defaultSeeds: PlatformHighScoreEntry[] = []) {
    const safeId = gameId.replace(/[^a-z0-9_-]/gi, '');
    this.filePath = path.join(DATA_DIR, `highscores_${safeId}.json`);
    this.load(defaultSeeds);
  }

  private load(defaultSeeds: PlatformHighScoreEntry[]): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.entries = parsed;
          return;
        }
      }
    } catch {
      // ignore read errors
    }
    this.entries = [...defaultSeeds];
    this.save();
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  }

  public getTop(limit = 10): PlatformHighScoreEntry[] {
    return this.entries.slice(0, limit);
  }

  public recordScore(entry: PlatformHighScoreEntry): PlatformHighScoreEntry[] {
    this.entries.push(entry);
    this.entries.sort((a, b) => b.score - a.score);
    this.entries = this.entries.slice(0, 10);
    this.save();
    return this.getTop();
  }
}
