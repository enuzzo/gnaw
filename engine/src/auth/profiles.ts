import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ProfileMetadata = {
  schemaVersion: 1;
  name: string;
  lastVerifiedUrl: string;
  lastVerifiedAt: string;
};

export type ListedProfile = ProfileMetadata & {
  locked: boolean;
};

export type ProfileLock = {
  release(): Promise<void>;
};

export type ProfileStore = ReturnType<typeof createProfileStore>;

const metadataFile = "gnaw-profile.json";
const lockFile = ".gnaw-profile.lock";

export class ProfileLockedError extends Error {
  readonly code = "profile_locked";

  constructor(readonly profileName: string) {
    super(`Auth profile is locked: ${profileName}`);
  }
}

export class ProfileNotFoundError extends Error {
  readonly code = "profile_not_found";

  constructor(readonly profileName: string) {
    super(`Auth profile was not found: ${profileName}`);
  }
}

export function defaultProfileRoot(): string {
  return process.env.GNAW_PROFILE_HOME ?? join(homedir(), "Library", "Application Support", "Gnaw", "profiles");
}

export function createProfileStore({ root = defaultProfileRoot() }: { root?: string } = {}) {
  return {
    root,

    profileDir(name: string): string {
      return join(root, validateProfileName(name));
    },

    async ensureProfileDir(name: string): Promise<string> {
      const dir = join(root, validateProfileName(name));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      return dir;
    },

    async saveMetadata(input: Omit<ProfileMetadata, "schemaVersion"> | ProfileMetadata): Promise<ProfileMetadata> {
      const name = validateProfileName(input.name);
      const dir = await this.ensureProfileDir(name);
      const metadata: ProfileMetadata = {
        schemaVersion: 1,
        name,
        lastVerifiedUrl: input.lastVerifiedUrl,
        lastVerifiedAt: input.lastVerifiedAt
      };
      await writeJson(join(dir, metadataFile), metadata);
      return metadata;
    },

    async readMetadata(name: string): Promise<ProfileMetadata> {
      const dir = this.profileDir(name);
      const raw = await readFile(join(dir, metadataFile), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          throw new ProfileNotFoundError(name);
        }
        throw error;
      });
      const metadata = JSON.parse(raw) as ProfileMetadata;
      return {
        schemaVersion: 1,
        name: validateProfileName(metadata.name),
        lastVerifiedUrl: metadata.lastVerifiedUrl,
        lastVerifiedAt: metadata.lastVerifiedAt
      };
    },

    async listProfiles(): Promise<ListedProfile[]> {
      const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      });
      const profiles = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              const metadata = await this.readMetadata(entry.name);
              return {
                ...metadata,
                locked: await fileExists(join(this.profileDir(entry.name), lockFile))
              };
            } catch {
              return null;
            }
          })
      );
      return profiles.filter((profile): profile is ListedProfile => profile !== null).sort((a, b) => a.name.localeCompare(b.name));
    },

    async deleteProfile(name: string): Promise<void> {
      if (await fileExists(join(this.profileDir(name), lockFile))) {
        throw new ProfileLockedError(name);
      }
      await rm(this.profileDir(name), { recursive: true, force: true });
    },

    async acquireLock(name: string): Promise<ProfileLock> {
      const dir = await this.ensureProfileDir(name);
      const path = join(dir, lockFile);
      let handle: FileHandle;
      try {
        handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new ProfileLockedError(name);
        }
        throw error;
      }
      await handle.writeFile(`${process.pid}\n`, "utf8");
      let released = false;
      return {
        async release() {
          if (released) {
            return;
          }
          released = true;
          await handle.close();
          await unlink(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
              throw error;
            }
          });
        }
      };
    }
  };
}

function validateProfileName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name === "." || name === "..") {
    throw new Error(`Invalid profile name: ${name}`);
  }
  return name;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
