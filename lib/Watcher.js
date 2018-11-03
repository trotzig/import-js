// @flow

import fbWatchman from 'fb-watchman';
import minimatch from 'minimatch';
import winston from 'winston';

import ExportsStorage from './ExportsStorage';
import findAllFiles from './findAllFiles';
import normalizePath from './normalizePath';

const SUBSCRIPTION_NAME = 'import-js-subscription';

export default class Watcher {
  workingDirectory: string;
  excludes: Array<string>;
  onFilesAdded: Function;
  onFilesRemoved: Function;
  storage: ExportsStorage;

  constructor({
    workingDirectory = process.cwd(),
    excludes = [],
    onFilesAdded = (): Promise<void> => Promise.resolve(),
    onFilesRemoved = (): Promise<void> => Promise.resolve(),
    storage,
  }: Object) { // eslint-disable-line object-curly-newline
    this.workingDirectory = workingDirectory;
    this.excludes = excludes;
    this.onFilesAdded = onFilesAdded;
    this.onFilesRemoved = onFilesRemoved;
    this.storage = storage;
  }

  subscribe({
    client,
    fbWatch,
    relativePath,
  }: {
      client: fbWatchman.Client,
      fbWatch: string,
      relativePath: string,
    }): Promise<void> {
    const subscription = {
      // Match javascript files
      expression: [
        'anyof',
        ['suffix', 'js'],
        ['suffix', 'jsx'],
        ['suffix', 'ts'],
        ['suffix', 'tsx'],
        ['suffix', 'coffee'],
        ['suffix', 'json'],
      ],
      fields: ['name', 'exists', 'mtime_ms'],
      relative_root: relativePath,
    };

    return new Promise((resolve: Function, reject: Function) => {
      client.command(['subscribe', fbWatch, SUBSCRIPTION_NAME, subscription], (error: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });

      client.on('subscription', (resp: Object) => {
        if (resp.subscription !== SUBSCRIPTION_NAME) {
          return;
        }

        const added = [];
        const removed = [];
        resp.files.forEach((file: Object) => {
          const normalizedPath = normalizePath(
            file.name,
            this.workingDirectory,
          );
          if (normalizedPath.indexOf('/node_modules/') !== -1) {
            return;
          }
          if (
            this.excludes.some((pattern: string): boolean =>
              minimatch(normalizedPath, pattern))
          ) {
            return;
          }
          if (file.exists) {
            added.push({ path: normalizedPath, mtime: +file.mtime_ms });
          } else {
            removed.push({ path: normalizedPath });
          }
        });
        if (added.length) {
          this.onFilesAdded(added);
        }
        if (removed.length) {
          this.onFilesRemoved(removed);
        }
      });
    });
  }

  startSubscription({ client }: { client: fbWatchman.Client }): Promise<void> {
    return new Promise((resolve: Function, reject: Function) => {
      client.command(['watch-project', this.workingDirectory], (
        error: Error,
        resp: Object,
      ) => {
        if (error) {
          reject(error);
          return;
        }

        if ('warning' in resp) {
          winston.warn(`WARNING received during watchman init: ${resp.warning}`);
        }

        this.subscribe({
          client,
          fbWatch: resp.watch,
          relativePath: resp.relative_path,
        })
          .then(resolve)
          .catch(reject);
      });
    });
  }

  initialize(): Promise<void> {
    return new Promise((resolve: Function, reject: Function) => {
      this.initializeWatchman().then(resolve).catch((error: Object) => {
        winston.warn(`
          Couldn't initialize the Watchman watcher. This is most likely because
          you don't have Watchman installed. Follow instructions here if you
          want to rid this warning:
          https://facebook.github.io/watchman/docs/install.html

          ImportJS will fall back to polling instead. This is slower, and more
          resource-heavy. Plus, changes will not be immediately available.
          \n
          Reason: ${error.message}\n${error.stack}
        `);
        this.initializePolling().then(resolve).catch(reject);
      });
    });
  }

  /**
   * Get all files from the watchman-powered cache. Returns a promise that will
   * resolve if watchman is available, and the file cache is enabled. Will
   * resolve immediately if previously initialized.
   */
  initializeWatchman(): Promise<void> {
    return new Promise((resolve: Function, reject: Function) => {
      const client = new fbWatchman.Client();
      client.on('error', (error: Error) => {
        reject(error);
      });
      client.capabilityCheck(
        {
          optional: [],
          required: ['relative_root'],
        },
        (error: Error) => {
          if (error) {
            client.end();
            reject(error);
          } else {
            this.startSubscription({ client }).then(resolve).catch(reject);
          }
        },
      );
    });
  }

  initializePolling(): Promise<void> {
    setInterval(
      () => {
        this.poll();
      },
      30000,
    );
    return this.poll();
  }

  poll(): Promise<void> {
    return new Promise((resolve: Function, reject: Function) => {
      findAllFiles(this.workingDirectory, this.excludes)
        .then((files: Array<Object>) => {
          const mtimes = {};
          files.forEach(({ path: pathToFile, mtime }: Object) => {
            mtimes[pathToFile] = mtime;
          });
          this.storage.allFiles().then((storedFiles: Array<string>) => {
            const removedFiles = [];
            storedFiles.forEach((storedFile: string) => {
              if (storedFile.startsWith('./node_modules/')) {
                // Ignore this file, as it won't be in the list of all files (we
                // exclude node_modules by default).
                return;
              }
              const mtime = mtimes[storedFile];
              if (!mtime) {
                removedFiles.push({ path: storedFile });
              }
            });
            this.onFilesAdded(files)
              .then((): Promise<void> => this.onFilesRemoved(removedFiles))
              .then(resolve)
              .catch(reject);
          });
        })
        .catch(reject);
    });
  }
}
