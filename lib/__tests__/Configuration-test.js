/* global spyOn */
import fs from 'fs';
import os from 'os';
import path from 'path';
import requireRelative from 'require-relative';

import globals from 'globals';

import Configuration from '../Configuration';
import FileUtils from '../FileUtils';
import version from '../version';

jest.mock('../FileUtils');
jest.mock('../version');
jest.mock('fs');
jest.mock('require-relative');

describe('Configuration', () => {
  afterEach(() => {
    fs.__reset();
    FileUtils.__reset();
    version.__reset();
  });

  describe('with camelCased configuration', () => {
    beforeEach(() => {
      FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
        declarationKeyword: 'const',
      });
    });

    it('does not have any messages', () => {
      const configuration = new Configuration();
      expect(configuration.messages).toEqual([]);
    });
  });

  describe('with unknown configuration', () => {
    beforeEach(() => {
      FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
        somethingStrange: true,
      });
    });

    it('has a message about unknown configuration', () => {
      const configuration = new Configuration();
      expect(configuration.messages).toEqual([
        'Unknown configuration: `somethingStrange`',
      ]);
    });
  });

  describe('#get()', () => {
    it('has default values', () => {
      const configuration = new Configuration();
      expect(configuration.get('aliases')).toEqual({});
      expect(configuration.get('declarationKeyword')).toEqual('import');
      expect(configuration.get('groupImports')).toEqual(true);
      expect(configuration.get('sortImports')).toEqual(true);
      expect(configuration.get('importDevDependencies')).toEqual(false);
      expect(configuration.get('importFunction')).toEqual('require');
      expect(configuration.get('stripFileExtensions')).toEqual(['.js', '.jsx', '.ts', '.tsx', '.coffee']);
      expect(configuration.get('useRelativePaths')).toEqual(true);
      expect(configuration.get('maxLineLength')).toEqual(80);
      expect(configuration.get('tab')).toEqual('  ');
      expect(configuration.get('logLevel')).toEqual('info');
      expect(configuration.get('mergableOptions')).toEqual({
        aliases: true,
        coreModules: true,
        namedExports: true,
        globals: true,
      });
    });

    describe('with a JSON configuration file', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.json'), {
          aliases: { foo: 'bar' },
          declarationKeyword: 'const',
        });
      });

      it('returns the configured value for the key', () => {
        expect(new Configuration().get('aliases')).toEqual({ foo: 'bar' });
      });

      it('has a deprecation message', () => {
        const configuration = new Configuration();
        expect(configuration.messages).toEqual([
          'Using JSON to configure ImportJS is deprecated and will go away ' +
            'in a future version. Use an `.importjs.js` file instead.',
        ]);
      });

      describe('and a javascript configuration file', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            aliases: { bar: 'foo' },
          });
        });

        it('prefers the javascript file', () => {
          expect(new Configuration().get('aliases')).toEqual({ bar: 'foo' });
        });
      });
    });

    describe('with a javascript configuration file in home directory', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(os.homedir(), '.importjs.js'), {
          declarationKeyword: 'const',
        });
      });

      it('returns the configured value for the key', () => {
        expect(new Configuration().get('declarationKeyword')).toEqual('const');
      });

      describe('and a project javascript configuration file', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            declarationKeyword: 'import',
          });
        });

        it('prefers project file', () => {
          expect(new Configuration().get('declarationKeyword')).toEqual('import');
        });
      });
    });

    describe('with a javascript configuration file', () => {
      describe('that will not parse', () => {
        beforeEach(() => {
          spyOn(FileUtils, 'readJsFile').and.throwError('Syntax error');
        });

        it('has a message about the failure', () => {
          const configuration = new Configuration();
          expect(configuration.messages[0]).toMatch(/Unable to parse configuration file/);
        });
      });

      describe('that does not export anything', () => {
        beforeEach(() => {
          // This is what the built-in `require` method will do if a javascript
          // file doesn't export anything.
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {});
        });

        it('has a message about the failure', () => {
          const configuration = new Configuration();
          expect(configuration.messages[0]).toMatch(/Nothing exported from \.importjs\.js/);
        });
      });
    });

    describe('with a minimumVersion', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          minimumVersion: '1.2.3',
        });
      });

      it('does not throw an error when current version is newer', () => {
        version.__setVersion('1.2.3');
        expect(() => new Configuration()).not.toThrow();
      });

      it('throws an error when current version is older', () => {
        version.__setVersion('1.2.2');
        expect(() => new Configuration()).toThrow(new Error('The configuration file for this project requires version ' +
              '1.2.3 or newer. You are using 1.2.2.'));
      });
    });

    describe('with a configuration option that is a function', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          declarationKeyword: ({ pathToImportedModule, pathToCurrentFile }) => {
            if (/test\.js/.test(pathToImportedModule)) {
              return 'var';
            }
            if (/test\.js/.test(pathToCurrentFile)) {
              return 'const';
            }
            return 'import';
          },
        });
      });

      describe('when using `pathToImportedModule`', () => {
        it('invokes the method and returns the right value', () => {
          const configuration = new Configuration('/foo/component.js');
          expect(configuration.get('declarationKeyword', {
            pathToImportedModule: '/foo/test.js',
          })).toEqual('var');
        });
      });

      describe('when using `pathToCurrentFile`', () => {
        it('invokes the method and returns the right value', () => {
          const configuration = new Configuration('/foo/test.js');
          expect(configuration.get('declarationKeyword', {
            pathToImportedModule: '/component.js',
          })).toEqual('const');
        });
      });

      describe('when using none of the paths', () => {
        it('invokes the method and returns the right value', () => {
          const configuration = new Configuration('/foo/bar.js');
          expect(configuration.get('declarationKeyword', {
            pathToImportedModule: '/bar/foo.js',
          })).toEqual('import');
        });
      });
    });
  });

  describe('#get aliases', () => {
    it('returns an empty object', () => {
      expect(new Configuration().get('aliases')).toEqual({});
    });

    describe('with a javascript configuration file', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          aliases: { foo: 'bar' },
        });
      });

      it('returns the configured value for the key', () => {
        expect(new Configuration().get('aliases')).toEqual({ foo: 'bar' });
      });
    });
  });

  describe('#get coreModules', () => {
    it('returns an empty array', () => {
      expect(new Configuration().get('coreModules')).toEqual([]);
    });

    describe('in a meteor environment', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['meteor'],
        });
      });

      it('returns meteor core modules', () => {
        expect(new Configuration().get('coreModules')).toEqual([
          'meteor/accounts-base',
          'meteor/blaze',
          'meteor/check',
          'meteor/ddp-client',
          'meteor/ddp-rate-limiter',
          'meteor/ejson',
          'meteor/email',
          'meteor/http',
          'meteor/check',
          'meteor/meteor',
          'meteor/mongo',
          'meteor/random',
          'meteor/reactive-var',
          'meteor/session',
          'meteor/templating',
          'meteor/tracker',
        ]);
      });
      describe('with user defined coreModules', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            environments: ['meteor'],
            coreModules: ['FOO', 'bar'],
          });
        });

        it('merges user and meteor core modules', () => {
          expect(new Configuration().get('coreModules')).toEqual([
            'FOO',
            'bar',
            'meteor/accounts-base',
            'meteor/blaze',
            'meteor/check',
            'meteor/ddp-client',
            'meteor/ddp-rate-limiter',
            'meteor/ejson',
            'meteor/email',
            'meteor/http',
            'meteor/check',
            'meteor/meteor',
            'meteor/mongo',
            'meteor/random',
            'meteor/reactive-var',
            'meteor/session',
            'meteor/templating',
            'meteor/tracker',
          ]);
        });
        describe('with mergableOptions.coreModules set to false', () => {
          beforeEach(() => {
            FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
              environments: ['meteor'],
              coreModules: ['FOO', 'bar'],
              mergableOptions: { coreModules: false },
            });
          });

          it('returns only user coreModules', () => {
            expect(new Configuration().get('coreModules')).toEqual([
              'FOO',
              'bar',
            ]);
          });
        });
      });
    });

    describe('in a node environment', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['node'],
        });
      });

      it('returns node core modules', () => {
        expect(new Configuration().get('coreModules')).toEqual([
          'assert',
          'buffer',
          'child_process',
          'cluster',
          'console',
          'constants',
          'crypto',
          'dgram',
          'dns',
          'domain',
          'events',
          'fs',
          'http',
          'https',
          'module',
          'net',
          'os',
          'path',
          'punycode',
          'querystring',
          'readline',
          'repl',
          'stream',
          'string_decoder',
          'sys',
          'timers',
          'tls',
          'tty',
          'url',
          'util',
          'v8',
          'vm',
          'zlib',
        ]);
      });
    });

    describe('in multiple environments', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['node', 'meteor'],
        });
      });

      it('returns core modules from all environments', () => {
        const coreModules = new Configuration().get('coreModules');
        expect(coreModules).toContain('child_process');
        expect(coreModules).toContain('meteor/check');
      });
    });
  });

  describe('#get globals', () => {
    it('returns javascript builtins', () => {
      expect(new Configuration().get('globals')).toEqual(Object.keys(globals.builtin));
    });

    describe('with a javascript configuration file', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          globals: ['FOO', 'Bar'],
        });
      });

      it('returns the configured value merged with defaults', () => {
        expect(new Configuration().get('globals')).toEqual([
          'FOO',
          'Bar',
          ...Object.keys(globals.builtin),
        ]);
      });
    });

    describe('in a meteor environment', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['meteor'],
        });
      });

      it('returns meteor globals', () => {
        const ourGlobals = new Configuration().get('globals');
        expect(ourGlobals).toEqual([
          ...Object.keys(globals.builtin),
          ...Object.keys(globals.meteor),
        ]);
        expect(ourGlobals).toContain('Meteor');
        expect(ourGlobals).toContain('Package');
      });
      describe('with user defined globals', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            environments: ['meteor'],
            globals: ['FOO', 'bar'],
          });
        });

        it('merges user, meteor and default globals', () => {
          expect(new Configuration().get('globals')).toEqual([
            'FOO',
            'bar',
            ...Object.keys(globals.builtin),
            ...Object.keys(globals.meteor),
          ]);
        });
        describe('with mergableOptions.globals set to false', () => {
          beforeEach(() => {
            FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
              environments: ['meteor'],
              globals: ['FOO', 'bar'],
              mergableOptions: { globals: false },
            });
          });

          it('returns only user globals', () => {
            expect(new Configuration().get('globals')).toEqual([
              'FOO',
              'bar',
            ]);
          });
        });
      });
    });

    describe('in a node environment', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['node'],
        });
      });

      it('returns node globals', () => {
        const ourGlobals = new Configuration().get('globals');
        expect(ourGlobals).toEqual([
          ...Object.keys(globals.builtin),
          ...Object.keys(globals.node),
        ]);
        expect(ourGlobals).toContain('process');
        expect(ourGlobals).toContain('__dirname');
        expect(ourGlobals).toContain('setImmediate');
      });
    });

    describe('in multiple environments', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['node', 'meteor'],
        });
      });

      it('returns globals all environments', () => {
        const ourGlobals = new Configuration().get('globals');
        expect(ourGlobals).toEqual([
          ...Object.keys(globals.builtin),
          ...Object.keys(globals.node),
          ...Object.keys(globals.meteor),
        ]);
        expect(ourGlobals).toContain('Meteor');
        expect(ourGlobals).toContain('Package');
        expect(ourGlobals).toContain('process');
        expect(ourGlobals).toContain('__dirname');
        expect(ourGlobals).toContain('setImmediate');
      });
    });
  });

  describe('#get moduleSideEffectImports', () => {
    describe('in meteor environment', () => {
      describe('with no side-effect imports for a component', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            useRelativePaths: true,
            environments: ['meteor'],
          });
        });

        it('finds no side-effect imports for components', () => {
          const configuration = new Configuration('./foo/component.js');
          expect(configuration.get('moduleSideEffectImports').sort()).toEqual([
          ]);
        });
      });

      describe('with useRelativePaths true', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            useRelativePaths: true,
            environments: ['meteor'],
          });
          fs.__setFile(path.join(process.cwd(), 'foo', 'component.css'), '', {
            isDirectory: () => false,
          });
          fs.__setFile(path.join(process.cwd(), 'foo', 'component.html'), '', {
            isDirectory: () => false,
          });
        });

        it(
          'finds side-effect imports for components and gives them relative paths',
          () => {
            const configuration = new Configuration('./foo/component.js');
            expect(configuration.get('moduleSideEffectImports').sort()).toEqual(['./component.css', './component.html']);
          },
        );
        it(
          'finds side-effect imports for components related to jsx modules',
          () => {
            const configuration = new Configuration('./foo/component.jsx');
            expect(configuration.get('moduleSideEffectImports').sort()).toEqual(['./component.css', './component.html']);
          },
        );
        it(
          'returns no side-effect imports for components related to unknown module types',
          () => {
            const configuration = new Configuration('./foo/component.unk');
            expect(configuration.get('moduleSideEffectImports').sort()).toEqual([]);
          },
        );
      });

      describe('with useRelativePaths false', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            useRelativePaths: false,
            environments: ['meteor'],
          });
          fs.__setFile(path.join(process.cwd(), 'foo', 'component.css'), '', {
            isDirectory: () => false,
          });
          fs.__setFile(path.join(process.cwd(), 'foo', 'component.html'), '', {
            isDirectory: () => false,
          });
        });

        it(
          'finds side-effect imports for components and gives them absolute paths',
          () => {
            const configuration = new Configuration('./foo/component.js');
            expect(configuration.get('moduleSideEffectImports').sort()).toEqual(['/foo/component.css', '/foo/component.html']);
          },
        );
      });
    });
  });

  describe('#get namedExports from meteor environment', () => {
    beforeEach(() => {
      FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
        environments: ['meteor'],
      });
      fs.__setFile(
        path.join(process.cwd(), '.meteor', 'packages'),
        `
john:foo
jane:bar
john:foobar
jane:barbaz
        `.trim(),
        { isDirectory: () => false },
      );
      fs.__setFile(
        path.join(process.cwd(), '.meteor', 'versions'),
        `
john:foo@1.0.0
jane:bar@0.0.1
john:foobar@1.0.0
jane:barbaz@0.0.1
        `.trim(),
        { isDirectory: () => false },
      );
      FileUtils.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foo',
          '1.0.0',
          'isopack.json',
        ),
        {
          name: 'foo',
          summary: 'Metasyntactic package name #1',
          version: '1.0.0',
          isTest: false,
          'isopack-2': {
            builds: [
              {
                kind: 'main',
                arch: 'os',
                path: 'os.json',
              },
            ],
          },
        },
      );
      FileUtils.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foo',
          '1.0.0',
          'os.json',
        ),
        {
          format: 'isopack-2-unibuild',
          declaredExports: [
            {
              name: 'foosball',
              testOnly: false,
            },
          ],
        },
      );
      FileUtils.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_bar',
          'isopack.json',
        ),
        {
          name: 'bar',
          summary: 'Metasyntactic package name #2',
          version: '0.0.1',
          isTest: false,
          'isopack-2': {
            builds: [
              {
                kind: 'main',
                arch: 'os',
                path: 'os.json',
              },
            ],
          },
        },
      );
      FileUtils.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_bar',
          'os.json',
        ),
        {
          format: 'isopack-2-unibuild',
          declaredExports: [
            {
              name: 'barsketball',
              testOnly: false,
            },
          ],
        },
      );
      // Atmosphere package john:foobar files
      FileUtils.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foobar',
          '1.0.0',
          'isopack.json',
        ),
        {
          name: 'foobar',
          summary: 'Metasyntactic package name #3',
          version: '1.0.0',
          isTest: false,
          'isopack-2': {
            builds: [
              {
                kind: 'main',
                arch: 'os',
                path: 'os.json',
              },
            ],
          },
        },
      );
      FileUtils.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foobar',
          '1.0.0',
          'os.json',
        ),
        {
          format: 'isopack-2-unibuild',
          declaredExports: [
          ],
          resources: [
            {
              type: 'source',
              extension: 'js',
              file: 'os/check-npm-versions.js',
              length: 178,
              offset: 0,
              path: 'check-npm-versions.js',
              hash: '7f6009ada7f566cbcfa441c7950448410a091512',
              fileOptions: {},
            },
            {
              type: 'source',
              extension: 'js',
              file: 'os/exports.js',
              length: 241,
              offset: 0,
              path: 'exports.js',
              hash: '85680aa23dc24bbd98196e191633a75fb7a46755',
              fileOptions: {
                mainModule: true,
              },
            },
            {
              type: 'source',
              extension: 'js',
              file: 'os/Baz.js',
              length: 8713,
              offset: 0,
              path: 'Baz.js',
              hash: 'f202d25ce0d36a2c3b7d5f5ac97b667ba4118aa9',
              fileOptions: {
                lazy: true,
              },
            },
          ],
        },
      );
      fs.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foobar',
          '1.0.0',
          'os',
          'exports.js',
        ),
        `
export const foobarsball = () => {};
export { foobarsballFunc } from './foobarsballFunc';
export * from './foobarNs';
        `.trim(),
      );
      fs.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foobar',
          '1.0.0',
          'os',
          'foobarsballFunc.js',
        ),
        `
export const foobarsballFunc = () => {};
export const notExportedFromModule = 'BAZ';
        `.trim(),
      );
      fs.__setFile(
        path.join(
          os.homedir(),
          '.meteor',
          'packages',
          'john_foobar',
          '1.0.0',
          'os',
          'foobarNs.js',
        ),
        `
export const foobarQux = () => {};
export function foobarQuux () {};
const foobarCorge = 'CORGE';
export { foobarCorge };
        `.trim(),
      );
      // local package jane:barbaz files
      FileUtils.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_barbaz',
          'isopack.json',
        ),
        {
          name: 'barbaz',
          summary: 'Metasyntactic package name #2',
          version: '0.0.1',
          isTest: false,
          'isopack-2': {
            builds: [
              {
                kind: 'main',
                arch: 'web.browser',
                path: 'web.browser.json',
              },
            ],
          },
        },
      );
      FileUtils.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_barbaz',
          'web.browser.json',
        ),
        {
          format: 'isopack-2-unibuild',
          declaredExports: [
          ],
          resources: [
            {
              type: 'source',
              extension: 'js',
              file: 'web.browser/check-npm-versions.js',
              length: 178,
              offset: 0,
              path: 'check-npm-versions.js',
              hash: '7f6009ada7f566cbcfa441c7950448410a091512',
              fileOptions: {},
            },
            {
              type: 'source',
              extension: 'js',
              file: 'web.browser/main.js',
              length: 241,
              offset: 0,
              path: 'main.js',
              hash: '85680aa23dc24bbd98196e191633a75fb7a46755',
              fileOptions: {
                mainModule: true,
              },
            },
            {
              type: 'source',
              extension: 'js',
              file: 'web.browser/Baz.js',
              length: 8713,
              offset: 0,
              path: 'Baz.js',
              hash: 'f202d25ce0d36a2c3b7d5f5ac97b667ba4118aa9',
              fileOptions: {
                lazy: true,
              },
            },
          ],
        },
      );
      fs.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_barbaz',
          'web.browser',
          'main.js',
        ),
        `
export const barbazsketball = () => {};
export { barbazsketballFunc } from './folder/barbazsketballFunc';
export * from './barbazNs';
        `.trim(),
      );
      fs.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_barbaz',
          'web.browser',
          'folder',
          'barbazsketballFunc.js',
        ),
        `
export const barbazsketballFunc = () => {};
export const notExportedFromModule = 'BAZ';
        `.trim(),
      );
      fs.__setFile(
        path.join(
          process.cwd(),
          '.meteor',
          'local',
          'isopacks',
          'jane_barbaz',
          'web.browser',
          'barbazNs.js',
        ),
        `
export const barbazQux = () => {};
export function barbazQuux () {};
const barbazCorge = 'CORGE';
export { barbazCorge };
        `.trim(),
      );

      // Mock requireRelative. so it returns a path to our mocked modules
      requireRelative.resolve.mockImplementation((module) => {
        let resolvedPath = '';
        if (module === './barbazNs') {
          resolvedPath = path.join(
            process.cwd(),
            '.meteor',
            'local',
            'isopacks',
            'jane_barbaz',
            'web.browser',
            'barbazNs.js',
          );
        } else if (module === './foobarNs') {
          resolvedPath = path.join(
            os.homedir(),
            '.meteor',
            'packages',
            'john_foobar',
            '1.0.0',
            'os',
            'foobarNs.js',
          );
        }
        return resolvedPath;
      });
    });
    const expectedNamedExports = {
      // These namedExports are the core ones that are always returned for Meteor
      'meteor/accounts-base': [
        'AccountsClient',
        'Accounts',
        'AccountsServer',
      ],
      'meteor/blaze': ['Blaze'],
      'meteor/check': ['check', 'Match'],
      'meteor/ddp-client': ['DDP'],
      'meteor/ddp-rate-limiter': ['DDPRateLimiter'],
      'meteor/ejson': ['EJSON'],
      'meteor/email': ['Email'],
      'meteor/http': ['HTTP'],
      'meteor/meteor': ['Meteor'],
      'meteor/mongo': ['Mongo'],
      'meteor/random': ['Random'],
      'meteor/reactive-var': ['ReactiveVar'],
      'meteor/session': ['Session'],
      'meteor/templating': ['Template'],
      'meteor/tracker': ['Tracker'],
      // These namedExports should be extracted from the Meteor metadata
      'meteor/john:foo': ['foosball'],
      'meteor/jane:bar': ['barsketball'],
      'meteor/john:foobar': [
        'foobarsball',
        'foobarsballFunc',
        'foobarQux',
        'foobarQuux',
        'foobarCorge',
      ],
      'meteor/jane:barbaz': [
        'barbazsketball',
        'barbazsketballFunc',
        'barbazQux',
        'barbazQuux',
        'barbazCorge',
      ],
    };
    it('extracts namedExports and merges them into a single object', () => {
      expect(new Configuration().get('namedExports')).toEqual(expectedNamedExports);
    });

    describe('with user defined namedExports', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['meteor'],
          namedExports: {
            'lib/utils': [
              'escape',
              'hasKey',
            ],
          },
        });
      });

      // Perhaps we will need this later.
      // it('has a deprecation message', () => {
      //   const configuration = new Configuration();
      //   expect(configuration.messages).toEqual([
      //     'Using namedExports to configure ImportJS is deprecated and will ' +
      //     'go away in a future version.',
      //   ]);
      // });

      it('merges user, meteor and found namedExports', () => {
        expect(new Configuration().get('namedExports')).toEqual({
          ...expectedNamedExports,
          'lib/utils': [
            'escape',
            'hasKey',
          ],
        });
      });
    });

    describe('with mergableOptions.namedExports set to false', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['meteor'],
          namedExports: {
            'lib/utils': [
              'escape',
              'hasKey',
            ],
          },
          mergableOptions: { namedExports: false },
        });
      });

      it('returns only user namedExports', () => {
        expect(new Configuration().get('namedExports')).toEqual({
          'lib/utils': [
            'escape',
            'hasKey',
          ],
        });
      });
    });
  });

  describe("#get('packageDependencies')", () => {
    it('returns an empty array', () => {
      expect(new Configuration().get('packageDependencies')).toEqual(new Set([]));
    });

    describe('with dependencies', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), 'package.json'), {
          dependencies: {
            foo: '1.0.0',
            bar: '2.0.0',
          },
        });
      });

      it('returns an array of dependencies', () => {
        expect(new Configuration().get('packageDependencies')).toEqual(new Set(['foo', 'bar']));
      });
    });

    describe('with dependencies and peerDependencies', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), 'package.json'), {
          dependencies: {
            foo: '1.0.0',
          },
          peerDependencies: {
            bar: '2.0.0',
          },
        });
      });

      it('returns an array of dependencies and peerDependencies', () => {
        expect(new Configuration().get('packageDependencies')).toEqual(new Set(['foo', 'bar']));
      });
    });

    describe('with dependencies and devDependencies', () => {
      beforeEach(() => {
        FileUtils.__setFile(path.join(process.cwd(), 'package.json'), {
          dependencies: {
            foo: '1.0.0',
          },
          devDependencies: {
            bar: '2.0.0',
          },
        });
      });

      it('leaves out devDependencies', () => {
        expect(new Configuration().get('packageDependencies')).toEqual(new Set(['foo']));
      });

      describe('when importDevDependencies is true', () => {
        beforeEach(() => {
          FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
            importDevDependencies: true,
          });
        });

        it('returns devDependencies as well', () => {
          expect(new Configuration().get('packageDependencies')).toEqual(new Set(['foo', 'bar']));
        });
      });
    });

    describe('in Meteor environment with package dependencies', () => {
      beforeEach(() => {
        fs.__setFile(
          path.join(process.cwd(), '.meteor/packages'),
          `
# comment to be ignored
   john:foo-bar  # has leading white space
check # core package to be ignored
jane:bar-foo@1.0.0   # version to be stripped
          `.trim(),
          { isDirectory: () => false },
        );
        FileUtils.__setFile(path.join(process.cwd(), 'package.json'), {
          dependencies: {
            foo: '1.0.0',
            bar: '2.0.0',
          },
        });
        FileUtils.__setFile(path.join(process.cwd(), '.importjs.js'), {
          environments: ['meteor'],
        });
      });

      it('returns an array of Meteor and npm dependencies', () => {
        expect(new Configuration().get('packageDependencies')).toEqual(new Set(['meteor/john:foo-bar', 'meteor/jane:bar-foo', 'foo', 'bar']));
      });
    });
  });
});
