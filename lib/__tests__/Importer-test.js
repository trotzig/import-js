import path from 'path';

import requireRelative from 'require-relative';

import FileUtils from '../FileUtils';
import Importer from '../Importer';
import ModuleFinder from '../ModuleFinder';
import normalizePath from '../normalizePath';
import readFile from '../readFile';
import requireResolve from '../requireResolve';

jest.mock('require-relative');
jest.mock('../FileUtils');
jest.mock('../requireResolve');
jest.mock('../readFile');

describe('Importer', () => {
  let word;
  let text;
  let existingFiles;
  let packageJsonContent;
  let packageDependencies;
  let pathToCurrentFile;
  let configuration;
  let setup;
  let moduleFinder;

  beforeEach(() => {
    moduleFinder = ModuleFinder.getForWorkingDirectory(process.cwd(), {
      excludes: [],
      ignorePackagePrefixes: [],
    });
    return moduleFinder.initializeStorage(':memory:');
  });

  afterEach(() => moduleFinder.storage.close());

  beforeEach(() => {
    word = 'foo';
    text = 'foo';
    existingFiles = [];
    packageJsonContent = {};
    packageDependencies = [];

    pathToCurrentFile = 'test.js';
    configuration = {};

    readFile.mockImplementation((file) => {
      if (/\.json$/.test(file)) {
        return Promise.resolve('{}');
      }
      return Promise.resolve('export default {}');
    });

    setup = async () => {
      if (Object.keys(configuration).length) {
        FileUtils.__setFile(
          path.join(process.cwd(), '.importjs.js'),
          configuration,
        );
      }

      // Convert the array to an object, as it is in the package.json file.
      const dependencies = packageDependencies.reduce(
        (depsObj, dependency) =>
          Object.assign({}, depsObj, { [dependency]: '1.0.0' }),
        {},
      );
      FileUtils.__setFile(path.join(process.cwd(), 'package.json'), {
        dependencies,
      });

      FileUtils.__setFileFallback((file) => {
        if (file in packageJsonContent) {
          return packageJsonContent[file];
        }

        for (let i = 0; i < packageDependencies.length; i += 1) {
          const dep = packageDependencies[i];
          if (file.indexOf(dep) !== -1) {
            return { main: `${dep}-main.jsx` };
          }
        }
        return null;
      });

      packageDependencies.forEach((dep) => {
        requireResolve.__addResolvedPath(
          path.join(process.cwd(), 'node_modules', dep),
          path.join(process.cwd(), 'node_modules', dep, `${dep}-main.jsx`),
        );
      });

      await moduleFinder.handleFilesAdded(existingFiles.map(f => ({
        path: normalizePath(f, process.cwd()),
        mtime: Date.now(),
      })));
      await moduleFinder.handleFilesAdded(packageDependencies.map(dep => ({
        path: normalizePath(
          path.join('node_modules', dep, `${dep}-main.jsx`),
          process.cwd(),
        ),
        mtime: Date.now(),
        packageName: dep,
      })));
    };
  });

  afterEach(() => {
    FileUtils.__reset();
    requireResolve.__reset();
  });

  it('has a message about unknown configuration', async () => {
    configuration = { somethingStrange: 'foo' };
    await setup();
    const importer = new Importer(
      text.split('\n'),
      pathToCurrentFile,
      process.cwd(),
    );
    expect(importer.messages).toEqual([
      'Unknown configuration: `somethingStrange`',
    ]);
  });

  describe('#import', () => {
    let subject;
    let result;

    beforeEach(() => {
      subject = async () => {
        await setup();
        result = await new Importer(text.split('\n'), pathToCurrentFile, process.cwd()).import(word);
        return result.fileContent;
      };
    });

    describe('with a variable name that will not resolve', () => {
      it('leaves the buffer unchanged', async () => {
        expect(await subject()).toEqual(text);
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual([
          `No JS module to import for \`${word}\``,
        ]);
      });

      it('does not ask you to resolve manually', async () => {
        await subject();
        expect(result.unresolvedImports).toEqual({});
      });
    });

    describe('with a variable name that will resolve', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx'];
      });

      it('adds an import to the top of the buffer', async () => {
        expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
        `.trim());
      });

      it('displays a message about the imported module', async () => {
        await subject();
        expect(result.messages).toEqual(["Imported foo from './bar/foo'"]);
      });

      describe('when that import is already imported', () => {
        beforeEach(() => {
          text = `
import foo from './bar/foo';

foo
          `.trim();
        });

        it('leaves the buffer unchanged', async () => {
          expect(await subject()).toEqual(text);
        });
      });

      it("adds the import below existing 'use strict'", async () => {
        text = `
'use strict';

foo
        `.trim();

        expect(await subject()).toEqual(`
'use strict';

import foo from './bar/foo';

foo
          `.trim());
      });

      it("adds the import below two existing 'use strict's", async () => {
        text = `
'use strict';
'use strict';

foo
        `.trim();

        expect(await subject()).toEqual(`
'use strict';
'use strict';

import foo from './bar/foo';

foo
          `.trim());
      });

      it("adds the import with other imports under 'use strict'", async () => {
        text = `
'use strict';
import bar from './bar';

foo + bar
        `.trim();

        expect(await subject()).toEqual(`
'use strict';
import bar from './bar';
import foo from './bar/foo';

foo + bar
        `.trim());
      });

      it("adds a newline when there is no newline under 'use strict'", async () => {
        text = `
'use strict';
foo + bar
        `.trim();

        expect(await subject()).toEqual(`
'use strict';
import foo from './bar/foo';

foo + bar
        `.trim());
      });

      it('adds the import below "use strict" in double quotes', async () => {
        text = `
"use strict";

foo
        `.trim();

        expect(await subject()).toEqual(`
"use strict";

import foo from './bar/foo';

foo
        `.trim());
      });

      it(
        'adds the import below a one-line comment at the top of the file',
        async () => {
          text = `
// One-line comment

foo
        `.trim();

          expect(await subject()).toEqual(`
// One-line comment

import foo from './bar/foo';

foo
          `.trim());
        },
      );

      it(
        'adds the import below multiple one-line comments at the top of the file',
        async () => {
          text = `
// One-line comment
// Another one-line comment

foo
        `.trim();

          expect(await subject()).toEqual(`
// One-line comment
// Another one-line comment

import foo from './bar/foo';

foo
          `.trim());
        },
      );

      it('adds the import below an empty line after a comment', async () => {
        text = `
// One-line comment

foo
        `.trimRight();

        expect(await subject()).toEqual(`
// One-line comment

import foo from './bar/foo';

foo
          `.trim());
      });

      it('adds the import below one-line comments with empty lines', async () => {
        text = `
// One-line comment

// Another one-line comment

foo
        `.trim();

        expect(await subject()).toEqual(`
// One-line comment

// Another one-line comment

import foo from './bar/foo';

foo
          `.trim());
      });

      it(
        'adds the import below multi-line comments at the top of the file',
        async () => {
          text = `
/* Multi-line comment */

foo
        `.trim();

          expect(await subject()).toEqual(`
/* Multi-line comment */

import foo from './bar/foo';

foo
          `.trim());
        },
      );

      it('adds the import below a multi-line comment spanning lines', async () => {
        text = `
/*
Multi-line comment
that spans multiple lines
*/

foo
        `.trim();

        expect(await subject()).toEqual(`
/*
Multi-line comment
that spans multiple lines
*/

import foo from './bar/foo';

foo
          `.trim());
      });

      it('adds the import below weirdly stacked multi-line comments', async () => {
        text = `
/* Single-line multi-line comment *//*
Multi-line comment
that spans multiple lines
*/

foo
        `.trim();

        expect(await subject()).toEqual(`
/* Single-line multi-line comment *//*
Multi-line comment
that spans multiple lines
*/

import foo from './bar/foo';

foo
          `.trim());
      });

      it(
        'adds the import below both comment styles at the top of the file',
        async () => {
          text = `
// One-line comment
/* Multi-line comment */

foo
        `.trim();

          expect(await subject()).toEqual(`
// One-line comment
/* Multi-line comment */

import foo from './bar/foo';

foo
          `.trim());
        },
      );

      it(
        "adds the import below both styles of comments and 'use strict'",
        async () => {
          text = `
'use strict';
// One-line comment
/* Multi-line comment */

foo
        `.trim();

          expect(await subject()).toEqual(`
'use strict';
// One-line comment
/* Multi-line comment */

import foo from './bar/foo';

foo
        `.trim());
        },
      );

      describe('when sorting and grouping are disabled', () => {
        beforeEach(() => {
          configuration.groupImports = false;
          configuration.sortImports = false;
          configuration.appendImports = false;
        });

        it('leaves newlines', async () => {
          text = `
import bar from './bar';

import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
import foo from './bar/foo';
import bar from './bar';

import baz from './bar/baz';

foo
          `.trim());
        });

        it('leaves single-line comments', async () => {
          text = `
import bar from './bar';

// Comment
import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
import foo from './bar/foo';
import bar from './bar';

// Comment
import baz from './bar/baz';

foo
          `.trim());
        });

        it('leaves content before imports', async () => {
          text = `
'use strict';
// Comment A

// Comment B
import bar from './bar';
import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
'use strict';
// Comment A

// Comment B
import foo from './bar/foo';
import bar from './bar';
import baz from './bar/baz';

foo
          `.trim());
        });

        it('leaves multiple single-line comments', async () => {
          text = `
import bar from './bar';

// Comment A
// Comment B
import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
import foo from './bar/foo';
import bar from './bar';

// Comment A
// Comment B
import baz from './bar/baz';

foo
          `.trim());
        });

        it('leaves 1-line multi-line comments', async () => {
          text = `
import bar from './bar';

/* Comment */
import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
import foo from './bar/foo';
import bar from './bar';

/* Comment */
import baz from './bar/baz';

foo
          `.trim());
        });

        it('leaves n-line multi-line comments', async () => {
          text = `
import bar from './bar';

/* Comment
 * 123
 */
import baz from './bar/baz';

foo
          `.trim();

          expect(await subject()).toEqual(`
import foo from './bar/foo';
import bar from './bar';

/* Comment
 * 123
 */
import baz from './bar/baz';

foo
          `.trim());
        });
        it('appends instead of prepends', () => {
          configuration.appendImports = true;

          text = `
import bar from './bar';

foo
          `.trim();

          expect(subject()).toEqual(`
import bar from './bar';
import foo from './bar/foo';

foo
          `.trim());
        });
      });

      describe('when the variable name matches last folder+filename', () => {
        beforeEach(() => {
          existingFiles = ['sko/bar/foo.jsx'];
          word = 'barFoo';
          text = 'barFoo';
        });

        it('resolves the import', async () => {
          expect(await subject()).toEqual(`
import barFoo from './sko/bar/foo';

barFoo
          `.trim());
        });

        describe('when the last folder ends with an "s"', () => {
          beforeEach(() => {
            existingFiles = ['sko/bars/foo.jsx'];
          });

          it('resolves the import', async () => {
            expect(await subject()).toEqual(`
import barFoo from './sko/bars/foo';

barFoo
            `.trim());
          });

          describe('when the variable also has "s" at the end', () => {
            beforeEach(() => {
              word = 'barsFoo';
              text = 'barsFoo';
            });

            it('resolves the import', async () => {
              expect(await subject()).toEqual(`
import barsFoo from './sko/bars/foo';

barsFoo
              `.trim());
            });
          });
        });

        describe('when the last folder ends with "es"', () => {
          beforeEach(() => {
            existingFiles = ['sko/statuses/foo.jsx'];
            word = 'statusFoo';
            text = 'statusFoo';
          });

          it('resolves the import', async () => {
            expect(await subject()).toEqual(`
import statusFoo from './sko/statuses/foo';

statusFoo
            `.trim());
          });

          describe('when the variable also has "es" at the end', () => {
            beforeEach(() => {
              word = 'statusesFoo';
              text = 'statusesFoo';
            });

            it('resolves the import', async () => {
              expect(await subject()).toEqual(`
import statusesFoo from './sko/statuses/foo';

statusesFoo
              `.trim());
            });
          });
        });
      });

      describe(
        'when the variable resolves to a node.js conventional module',
        () => {
          beforeEach(() => {
            existingFiles = ['Foo/index.jsx'];
          });

          it('adds an import to the top of the buffer', async () => {
            expect(await subject()).toEqual(`
import foo from './Foo';

foo
          `.trim());
          });

          it('displays a message about the imported module', async () => {
            await subject();
            expect(result.messages).toEqual([
              "Imported foo from './Foo'",
            ]);
          });

          describe('when that module has a dot in its name', () => {
            beforeEach(() => {
              existingFiles = ['Foo.io/index.jsx'];
              word = 'FooIO';
              text = 'FooIO';
            });

            it('imports that module with the dot', async () => {
              expect(await subject()).toEqual(`
import FooIO from './Foo.io';

FooIO
            `.trim());
            });
          });
        },
      );

      describe('in a meteor environment', () => {
        beforeEach(() => {
          configuration.namedExports = {
            'meteor/meteor': ['Meteor'],
          };
          word = 'Meteor';
          text = `
import Gadget from 'gadget';

Meteor
          `.trim();
          configuration.environments = ['meteor'];
        });

        it('adds an import to the top of the buffer', async () => {
          expect(await subject()).toEqual(`
import { Meteor } from 'meteor/meteor';

import Gadget from 'gadget';

Meteor
          `.trim());
        });
      });

      it(
        'adds a require to the top of the buffer in a node environment',
        async () => {
          word = 'Readline';
          text = 'Readline';
          configuration.environments = ['node'];

          expect(await subject()).toEqual(`
const Readline = require('readline');

Readline
        `.trim());
        },
      );

      describe(
        'when the import resolves to a dependency from package.json',
        () => {
          beforeEach(() => {
            packageDependencies = ['foo-bar'];
            word = 'fooBar';
            text = 'fooBar';
          });

          it('adds an import to the top of the buffer', async () => {
            expect(await subject()).toEqual(`
import fooBar from 'foo-bar';

fooBar
          `.trim());
          });

          it('displays a message about the imported module', async () => {
            await subject();
            expect(result.messages).toEqual(["Imported fooBar from 'foo-bar'"]);
          });

          describe('when there is an exclude', () => {
            beforeEach(() => {
              configuration.excludes = ['./node_modules/foo-bar/*'];
            });

            afterEach(() => {
              configuration.excludes = [];
            });

            it('excludes the import', async () => {
              expect(await subject()).toEqual(`
fooBar
            `.trim());
            });
          });
        },
      );

      describe('when other imports exist', () => {
        beforeEach(() => {
          text = `
import zoo from './foo/zoo';
import bar from './foo/bar';

foo
          `.trim();
        });

        it('adds the import and sorts the entire list', async () => {
          expect(await subject()).toEqual(`
import bar from './foo/bar';
import foo from './bar/foo';
import zoo from './foo/zoo';

foo
          `.trim());
        });

        describe('when there are unconventional imports in the list', () => {
          // e.g. added through using the `importFunction` configuration option
          beforeEach(() => {
            text = `
const sko = customImportFunction('./sko');
import * as starBar from './star/bar';
import zoo from './foo/zoo'
import bar from './foo/bar';

foo
            `.trim();
          });

          it('adds the import and sorts the entire list with groups', async () => {
            expect(await subject()).toEqual(`
import bar from './foo/bar';
import foo from './bar/foo';
import * as starBar from './star/bar';
import zoo from './foo/zoo'

const sko = customImportFunction('./sko');

foo
            `.trim());
          });

          describe('and `groupImports` is false', () => {
            beforeEach(() => {
              configuration.groupImports = false;
            });

            it('adds the import and sorts all of them', async () => {
              expect(await subject()).toEqual(`
import bar from './foo/bar';
import foo from './bar/foo';
const sko = customImportFunction('./sko');
import * as starBar from './star/bar';
import zoo from './foo/zoo'

foo
              `.trim());
            });
          });
        });
      });

      describe('when there is an unconventional import', () => {
        beforeEach(() => {
          text = `
import zoo from './foo/zoo';
const tsar = require('./foo/bar').tsa;

foo
          `.trim();
        });

        it('adds the import and moves out the unconventional import', async () => {
          expect(await subject()).toEqual(`
import foo from './bar/foo';
import zoo from './foo/zoo';

const tsar = require('./foo/bar').tsa;

foo
        `.trim());
        });
      });

      describe('when there is a non-import inline with the imports', () => {
        beforeEach(() => {
          text = `
import bar from './bar';
import star from
  './star';
var { STRAWBERRY, CHOCOLATE } = bar.scoops;
import zoo from './foo/zoo';

foo
          `.trim();
        });

        it('breaks imports at that line', async () => {
          // A better solution would perhaps be to find the `var zoo` import and
          // move it up there with the rest. But there's a lot of complexity
          // involved in that, so cutting off at the non-import is a simpler
          // solution.
          expect(await subject()).toEqual(`
import bar from './bar';
import foo from './bar/foo';
import star from
  './star';

var { STRAWBERRY, CHOCOLATE } = bar.scoops;
import zoo from './foo/zoo';

foo
        `.trim());
        });
      });

      describe('when there is an import with line-breaks', () => {
        beforeEach(() => {
          text = `
import zoo from
  './foo/zoo';
import tsar from './foo/bar';

var import_foo = { from: b }
          `.trim();
        });

        it(
          'adds the import, sorts the entire list and keeps the line-break',
          async () => {
            expect(await subject()).toEqual(`
import foo from './bar/foo';
import tsar from './foo/bar';
import zoo from
  './foo/zoo';

var import_foo = { from: b }
        `.trim());
          },
        );
      });

      describe('when there is a blank line amongst current imports', () => {
        beforeEach(() => {
          text = `
import zoo from './foo/zoo';

import bar from './foo/bar';
foo
          `.trim();
        });

        it('adds the import, compacts, and sorts the entire list', async () => {
          expect(await subject()).toEqual(`
import bar from './foo/bar';
import foo from './bar/foo';
import zoo from './foo/zoo';

foo
          `.trim());
        });
      });

      describe(
        'when there are multiple blank lines amongst current imports',
        () => {
          beforeEach(() => {
            text = `
import zoo from './foo/zoo';

import frodo from './bar/frodo';


import bar from './foo/bar';

foo
          `.trim();
          });

          it('compacts the list', async () => {
            expect(await subject()).toEqual(`
import bar from './foo/bar';
import foo from './bar/foo';
import frodo from './bar/frodo';
import zoo from './foo/zoo';

foo
          `.trim());
          });
        },
      );

      describe('when multiple files resolve the variable', () => {
        beforeEach(() => {
          existingFiles = ['bar/foo.jsx', 'zoo/foo.js', 'zoo/goo/Foo/index.js'];
        });

        it('has no messages', async () => {
          await subject();
          expect(result.messages).toEqual([]);
        });

        it('records the alternatives to choose from', async () => {
          await subject();
          expect(result.unresolvedImports).toEqual({
            foo: [
              {
                displayName: "import foo from './bar/foo';",
                importPath: './bar/foo',
                data: {
                  filePath: './bar/foo.jsx',
                  importPath: './bar/foo',
                  isNamedExport: false,
                },
              },
              {
                displayName: "import foo from './zoo/foo';",
                importPath: './zoo/foo',
                data: {
                  filePath: './zoo/foo.js',
                  importPath: './zoo/foo',
                  isNamedExport: false,
                },
              },
              {
                displayName: "import foo from './zoo/goo/Foo';",
                importPath: './zoo/goo/Foo',
                data: {
                  filePath: 'zoo/goo/Foo/index.js',
                  importPath: './zoo/goo/Foo',
                  isNamedExport: false,
                },
              },
            ],
          });
        });
      });

      describe('when multiple files resolve the variable', () => {
        beforeEach(() => {
          existingFiles = ['zoo/goo/Foo/index.js', 'bar/foo.jsx'];
        });

        it('sorts the results', async () => {
          await subject();
          expect(result.unresolvedImports).toEqual({
            foo: [
              {
                displayName: "import foo from './bar/foo';",
                importPath: './bar/foo',
                data: {
                  filePath: './bar/foo.jsx',
                  importPath: './bar/foo',
                  isNamedExport: false,
                },
              },
              {
                displayName: "import foo from './zoo/goo/Foo';",
                importPath: './zoo/goo/Foo',
                data: {
                  filePath: 'zoo/goo/Foo/index.js',
                  importPath: './zoo/goo/Foo',
                  isNamedExport: false,
                },
              },
            ],
          });
        });
      });
    });

    describe('when there is an export named as the module', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.js'];
        readFile.mockImplementation(() => Promise.resolve(`
          const foo = 'foo';
          export { foo };
          export default function() {};
        `));
      });

      it('has no messages', async () => {
        await subject();
        expect(result.messages).toEqual([]);
      });

      it('records the alternatives to choose from', async () => {
        await subject();
        expect(result.unresolvedImports).toEqual({
          foo: [
            {
              displayName: "import foo from './bar/foo';",
              importPath: './bar/foo',
              data: {
                filePath: './bar/foo.js',
                importPath: './bar/foo',
                isNamedExport: false,
              },
            },
            {
              displayName: "import { foo } from './bar/foo';",
              importPath: './bar/foo',
              data: {
                filePath: './bar/foo.js',
                importPath: './bar/foo',
                isNamedExport: true,
              },
            },
          ],
        });
      });
    });

    describe('importing a module with a package.json file', () => {
      beforeEach(() => {
        existingFiles = ['Foo/package.json', 'Foo/build/main.js'];
      });

      describe('when `main` points to a JS file', () => {
        beforeEach(() => {
          packageJsonContent = {
            [path.join(process.cwd(), 'Foo/package.json')]: {
              main: 'build/main.js',
            },
          };
        });

        it('adds an import to the top of the buffer', async () => {
          expect(await subject()).toEqual(`
import foo from './Foo';

foo
          `.trim());
        });
      });

      describe('when `main` points to index.js in the same folder', () => {
        beforeEach(() => {
          existingFiles = ['Foo/package.json', 'Foo/index.js'];

          packageJsonContent = {
            [path.join(process.cwd(), 'Foo/package.json')]: {
              main: 'index.js',
            },
          };
        });

        it('adds an import to the top of the buffer', async () => {
          expect(await subject()).toEqual(`
import foo from './Foo';

foo
          `.trim());
        });
      });

      describe('when the module is named something.js', () => {
        beforeEach(() => {
          existingFiles = ['Foo.js/package.json', 'Foo.js/main.js'];
          text = 'FooJS';
          word = 'FooJS';

          packageJsonContent = {
            [path.join(process.cwd(), 'Foo.js/package.json')]: {
              main: 'main.js',
            },
          };
        });

        it('keeps the .js in the import', async () => {
          expect(await subject()).toEqual(`
import FooJS from './Foo.js';

FooJS
          `.trim());
        });
      });

      describe('when `main` is missing', () => {
        beforeEach(() => {
          packageJsonContent = {
            [path.join(process.cwd(), 'Foo.js/package.json')]: {},
          };
        });

        it('does not add an import', async () => {
          expect(await subject()).toEqual(`
foo
          `.trim());
        });
      });
    });

    describe('line wrapping', () => {
      describe('when lines exceed the configured max width', () => {
        beforeEach(() => {
          configuration.maxLineLength = 40;
          existingFiles = ['fiz/bar/biz/baz/fiz/buz/boz/foo.jsx'];
        });

        describe('when configured to use a tab character', () => {
          beforeEach(() => {
            configuration.tab = '\t';
          });

          it('wraps them and indents with a tab', async () => {
            expect(await subject()).toEqual(`
import foo from
\t'./fiz/bar/biz/baz/fiz/buz/boz/foo';

foo
            `.trim());
          });
        });

        describe('when configured to use two spaces', () => {
          beforeEach(() => {
            configuration.tab = '  ';
          });

          it('wraps them and indents with two spaces', async () => {
            expect(await subject()).toEqual(`
import foo from
  './fiz/bar/biz/baz/fiz/buz/boz/foo';

foo
            `.trim());
          });
        });
      });

      describe('when lines do not exceed the configured max width', () => {
        beforeEach(() => {
          configuration.maxLineLength = 80;
          existingFiles = ['bar/foo.jsx'];
        });

        it('does not wrap them', async () => {
          expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
          `.trim());
        });
      });
    });

    describe('configuration', () => {
      describe('with a moduleNameFormatter that manipulates the path', () => {
        beforeEach(() => {
          configuration.moduleNameFormatter = ({ moduleName }) =>
            `!foo!${moduleName}`;
          existingFiles = ['bar/foo.jsx'];
          text = 'foo';
          word = 'foo';
        });

        it('uses the manipulated path', async () => {
          expect(await subject()).toEqual(`
import foo from '!foo!./bar/foo';

foo
        `.trim());
        });
      });

      describe(
        'with an importStatementFormatter that manipulates the path',
        () => {
          beforeEach(() => {
            configuration.importStatementFormatter = ({ importStatement }) =>
              importStatement.replace(/;$/, '');
            existingFiles = ['bar/foo.jsx'];
            text = 'foo';
            word = 'foo';
          });

          it('uses the manipulated statement', async () => {
            expect(await subject()).toEqual(`
import foo from './bar/foo'

foo
        `.trim());
          });
        },
      );

      describe('with aliases', () => {
        beforeEach(() => {
          configuration.aliases = { $: 'jquery' };
          packageDependencies = ['jquery'];
          text = '$';
          word = '$';
        });

        it('resolves aliased imports to the aliases', async () => {
          expect(await subject()).toEqual(`
import $ from 'jquery';

$
        `.trim());
        });

        describe('and an alias has a dynamic {filename}', () => {
          beforeEach(() => {
            configuration.aliases = { styles: './{filename}.scss' };
            text = 'styles';
            word = 'styles';
            pathToCurrentFile = 'bar/foo.jsx';
          });

          it('uses the filename of the current file', async () => {
            expect(await subject()).toEqual(`
import styles from './foo.scss';

styles
            `.trim());
          });

          describe('when editing an anonymous file', () => {
            describe('that is nil', () => {
              beforeEach(() => {
                pathToCurrentFile = null;
              });

              it('does not replace the dynamic part', async () => {
                expect(await subject()).toEqual(`
import styles from './{filename}.scss';

styles
                `.trim());
              });
            });

            describe('that is an empty string', () => {
              beforeEach(() => {
                pathToCurrentFile = '';
              });

              it('does not replace the dynamic part', async () => {
                expect(await subject()).toEqual(`
import styles from './{filename}.scss';

styles
                `.trim());
              });
            });
          });
        });

        describe('and an alias contains a slash', () => {
          // https://github.com/galooshi/import-js/issues/39
          beforeEach(() => {
            configuration.aliases = { $: 'jquery/jquery' };
          });

          it('keeps the slash in the alias path', async () => {
            expect(await subject()).toEqual(`
import $ from 'jquery/jquery';

$
          `.trim());
          });
        });
      });

      describe('with `namedExports` object', () => {
        beforeEach(() => {
          configuration.namedExports = {
            'lib/utils': ['foo', 'bar'],
          };
          text = 'foo';
          word = 'foo';
        });

        describe('when the named export is a node_module', () => {
          beforeEach(() => {
            requireResolve.__addResolvedPath(
              'lib/utils',
              path.join(process.cwd(), 'node_modules/lib/utils.js'),
            );
          });

          it('resolves that import and uses a non-relative path', async () => {
            expect(await subject()).toEqual(`
import { foo } from 'lib/utils';

foo
            `.trim());
          });
        });

        describe('when the named export is a regular file', () => {
          beforeEach(() => {
            requireResolve.__addResolvedPath(
              'lib/utils',
              path.join(process.cwd(), 'lib/utils.js'),
            );
          });

          it('resolves that import', async () => {
            expect(await subject()).toEqual(`
import { foo } from 'lib/utils';

foo
            `.trim());
          });
        });
      });

      describe('with `namedExports` meteor object', () => {
        beforeEach(() => {
          configuration.namedExports = {
            'meteor/meteor': ['Meteor'],
          };
          text = 'Meteor';
          word = 'Meteor';
        });

        describe('when the named export is a meteor package', () => {
          beforeEach(() => {
            requireResolve.__addResolvedPath('meteor/meteor', '');
          });

          it('resolves that import and uses a non-relative path', async () => {
            expect(await subject()).toEqual(`
import { Meteor } from 'meteor/meteor';

Meteor
            `.trim());
          });
        });
      });

      describe('using `var`, `aliases` and a `namedExports` object', () => {
        beforeEach(() => {
          packageDependencies = ['underscore'];
          configuration = Object.assign(configuration, {
            declarationKeyword: 'var',
            namedExports: {
              underscore: ['memoize', 'debounce'],
            },
            aliases: {
              _: 'underscore',
            },
          });
          text = '_';
          word = '_';
        });

        it('resolves the main alias without destructuring', async () => {
          expect(await subject()).toEqual(`
var _ = require('underscore');

_
        `.trim());
        });

        describe('when a named import exists for the same module', () => {
          beforeEach(() => {
            text = `
var { memoize } = require('underscore');

_
            `.trim();
          });

          it('adds the default import', async () => {
            expect(await subject()).toEqual(`
var _ = require('underscore');
var { memoize } = require('underscore');

_
            `.trim());
          });
        });

        describe('when importing a named export', () => {
          beforeEach(() => {
            text = 'memoize';
            word = 'memoize';
          });

          it('resolves that import using destructuring', async () => {
            expect(await subject()).toEqual(`
var { memoize } = require('underscore');

memoize
            `.trim());
          });

          it('displays a message about the imported module', async () => {
            await subject();
            expect(result.messages).toContain("Imported { memoize } from 'underscore'");
          });

          describe('when the default import exists for the same module', () => {
            beforeEach(() => {
              text = `
var _ = require('underscore');

memoize
              `.trim();
            });

            it('adds the destructuring on a new line', async () => {
              expect(await subject()).toEqual(`
var _ = require('underscore');
var { memoize } = require('underscore');

memoize
              `.trim());
            });
          });

          describe(
            'when the default is already imported for destructured var',
            () => {
              beforeEach(() => {
                text = `
var _ = require('underscore');

var foo = require('foo');

memoize
              `.trim();
              });

              it('adds the destructuring on a new line', async () => {
                expect(await subject()).toEqual(`
var _ = require('underscore');
var { memoize } = require('underscore');

var foo = require('foo');

memoize
              `.trim());
              });
            },
          );

          describe('with other imports', () => {
            beforeEach(() => {
              packageDependencies.push('alphabet');
            });
            beforeEach(() => {
              text = `
const bar = require('foo/bar');
var { xyz } = require('alphabet');

memoize
              `.trim();
            });

            it('places the import at the right place', async () => {
              expect(await subject()).toEqual(`
const bar = require('foo/bar');

var { memoize } = require('underscore');
var { xyz } = require('alphabet');

memoize
              `.trim());
            });
          });

          describe(
            'when other destructured imports exist for the same module',
            () => {
              beforeEach(() => {
                text = `
var { xyz, debounce } = require('underscore');

memoize
              `.trim();
              });

              it('combines the destructured import and sorts items', async () => {
                expect(await subject()).toEqual(`
var { debounce, memoize, xyz } = require('underscore');

memoize
              `.trim());
              });

              describe(
                'when the module is already in the destructured object',
                () => {
                  beforeEach(() => {
                    text = `
var { debounce, memoize } = require('underscore');

memoize
                `.trim();
                  });

                  it('does not add a duplicate', async () => {
                    expect(await subject()).toEqual(`
var { debounce, memoize } = require('underscore');

memoize
                `.trim());
                  });
                },
              );
            },
          );
        });
      });

      describe('alias with `import` and a `namedExports` object', () => {
        beforeEach(() => {
          packageDependencies = ['underscore'];
          configuration = Object.assign(configuration, {
            declarationKeyword: 'import',
            namedExports: {
              underscore: ['memoize', 'debounce'],
            },
            aliases: {
              _: 'underscore',
            },
          });
          text = '_';
          word = '_';
        });

        it('resolves the main alias without a named import', async () => {
          expect(await subject()).toEqual(`
import _ from 'underscore';

_
          `.trim());
        });

        describe('when a named import exists for the same module', () => {
          beforeEach(() => {
            text = `
import { memoize } from 'underscore';

_
            `.trim();
          });

          it('adds the default import', async () => {
            expect(await subject()).toEqual(`
import _, { memoize } from 'underscore';

_
            `.trim());
          });
        });

        describe('when importing a named export', () => {
          beforeEach(() => {
            text = 'memoize';
            word = 'memoize';
          });

          it('uses a named import', async () => {
            expect(await subject()).toEqual(`
import { memoize } from 'underscore';

memoize
            `.trim());
          });

          describe('with other imports', () => {
            beforeEach(() => {
              packageDependencies.push('alphabet');
              text = `
import { xyz } from 'alphabet';

import bar from 'foo/bar';

memoize
              `.trim();
            });

            it('places the import at the right place', async () => {
              expect(await subject()).toEqual(`
import { memoize } from 'underscore';
import { xyz } from 'alphabet';

import bar from 'foo/bar';

memoize
              `.trim());
            });
          });

          describe('when other named imports exist for the same module', () => {
            beforeEach(() => {
              text = `
import { xyz, debounce } from 'underscore';

memoize
              `.trim();
            });

            it('combines the named import and sorts items', async () => {
              expect(await subject()).toEqual(`
import { debounce, memoize, xyz } from 'underscore';

memoize
              `.trim());
            });

            describe('when the module is already in the named imports', () => {
              beforeEach(() => {
                text = `
import { debounce, memoize, xyz } from 'underscore';

memoize
                `.trim();
              });

              it('does not add a duplicate', async () => {
                expect(await subject()).toEqual(`
import { debounce, memoize, xyz } from 'underscore';

memoize
                `.trim());
              });
            });
          });

          describe('when a default import exists for the same module', () => {
            beforeEach(() => {
              text = `
import _ from 'underscore';

memoize
              `.trim();
            });

            it('adds the named import', async () => {
              expect(await subject()).toEqual(`
import _, { memoize } from 'underscore';

memoize
              `.trim());
            });

            describe('when the module is already in the named import', () => {
              beforeEach(() => {
                text = `
import _, { memoize } from 'underscore';

memoize
                `.trim();
              });

              it('does not add a duplicate', async () => {
                expect(await subject()).toEqual(`
import _, { memoize } from 'underscore';

memoize
                `.trim());
              });
            });
          });
        });
      });

      describe('with a custom `importFunction`', () => {
        beforeEach(() => {
          existingFiles = ['bar/foo.js'];
        });

        describe('and `declarationKeyword=import`', () => {
          beforeEach(() => {
            configuration.importFunction = 'myRequire';
            configuration.declarationKeyword = 'import';
          });

          it('does nothing special', async () => {
            expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
            `.trim());
          });
        });

        describe('and `declarationKeyword=const`', () => {
          beforeEach(() => {
            configuration.importFunction = 'myRequire';
            configuration.declarationKeyword = 'const';
          });

          it('uses the custom import function instead of "require"', async () => {
            expect(await subject()).toEqual(`
const foo = myRequire('./bar/foo');

foo
            `.trim());
          });
        });
      });

      describe('when stripFileExtensions is empty', () => {
        beforeEach(() => {
          existingFiles = ['bar/foo.js'];
          configuration.stripFileExtensions = [];
        });

        it('keeps the file ending in the import', async () => {
          expect(await subject()).toEqual(`
import foo from './bar/foo.js';

foo
          `.trim());
        });
      });

      describe('with declarationKeyword=const', () => {
        beforeEach(() => {
          configuration.declarationKeyword = 'const';
        });

        describe('with a variable name that will resolve', () => {
          beforeEach(() => {
            existingFiles = ['bar/foo.jsx'];
          });

          it('adds an import to the top using the declarationKeyword', async () => {
            expect(await subject()).toEqual(`
const foo = require('./bar/foo');

foo
            `.trim());
          });

          describe('when that variable is already imported using `var`', () => {
            beforeEach(() => {
              text = `
var foo = require('./bar/foo');

foo
              `.trim();
            });

            it('changes the `var` to declarationKeyword', async () => {
              expect(await subject()).toEqual(`
const foo = require('./bar/foo');

foo
              `.trim());
            });
          });

          describe('when the import contains a line-break', () => {
            beforeEach(() => {
              text = `
var foo =
  require('./bar/foo');

foo
              `.trim();
            });

            it(
              'changes the `var` to declarationKeyword and removes space',
              async () => {
                expect(await subject()).toEqual(`
const foo = require('./bar/foo');

foo
              `.trim());
              },
            );
          });

          describe('when other imports exist', () => {
            beforeEach(() => {
              text = `
var zoo = require('foo/zoo');
let bar = require('foo/bar');

foo
              `.trim();
            });

            it('adds the import and sorts and groups the entire list', async () => {
              expect(await subject()).toEqual(`
const foo = require('./bar/foo');

var zoo = require('foo/zoo');

let bar = require('foo/bar');

foo
            `.trim());
            });
          });
        });
      });

      describe('with declarationKeyword=import', () => {
        beforeEach(() => {
          configuration.declarationKeyword = 'import';
        });

        describe('with a variable name that will resolve', () => {
          beforeEach(() => {
            existingFiles = ['bar/foo.jsx', 'bar/fromfoo.jsx'];
          });

          describe('when that variable is already imported using `var`', () => {
            beforeEach(() => {
              text = `
var foo = require('./bar/foo');

foo
              `.trim();
            });

            it('changes the `var` to declarationKeyword', async () => {
              expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
              `.trim());
            });
          });

          describe(
            'when that variable already exists with a different style',
            () => {
              beforeEach(() => {
                text = `
var foo = require("./bar/foo");

foo
              `.trim();
              });

              it(
                'changes `var` to declarationKeyword and doubles to singles',
                async () => {
                  expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
              `.trim());
                },
              );
            },
          );

          describe('when the imported variable has "from" in it', () => {
            beforeEach(() => {
              word = 'fromfoo';
              text = `
var fromfoo = require('./bar/fromfoo');

fromfoo
              `.trim();
            });

            it('changes the `var` to declarationKeyword', async () => {
              expect(await subject()).toEqual(`
import fromfoo from './bar/fromfoo';

fromfoo
              `.trim());
            });
          });

          describe('when the import contains a line-break', () => {
            beforeEach(() => {
              text = `
var foo =
  require('./bar/foo');

foo
              `.trim();
            });

            it(
              'changes the `var` to declarationKeyword and removes space',
              async () => {
                expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
              `.trim());
              },
            );
          });

          describe('when other imports exist', () => {
            beforeEach(() => {
              text = `
var zoo = require('foo/zoo');
let bar = require('foo/bar');

foo
              `.trim();
            });

            it('adds the import and sorts and groups the entire list', async () => {
              expect(await subject()).toEqual(`
import foo from './bar/foo';

var zoo = require('foo/zoo');

let bar = require('foo/bar');

foo
            `.trim());
            });
          });
        });
      });

      describe('in a meteor environment', () => {
        beforeEach(() => {
          configuration.environments = ['meteor'];
          existingFiles = ['bar/foo.jsx'];
          text = 'foo';
        });

        describe('with `useRelativePaths=true`', () => {
          beforeEach(() => {
            configuration.useRelativePaths = true;
          });

          it('uses a relative import path', async () => {
            expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
            `.trim());
          });

          describe('when the current file is an absolute path', () => {
            beforeEach(() => {
              pathToCurrentFile = `${process.cwd()}/bar/test.js`;
            });

            it('uses a relative import path', async () => {
              expect(await subject()).toEqual(`
import foo from './foo';

foo
              `.trim());
            });
          });
        });

        describe('with `useRelativePaths=false`', () => {
          beforeEach(() => {
            configuration.useRelativePaths = false;
          });

          it('uses an absolute import path', async () => {
            expect(await subject()).toEqual(`
import foo from '/bar/foo';

foo
            `.trim());
          });
        });
      });

      describe('with `useRelativePaths=true`', () => {
        beforeEach(() => {
          existingFiles = ['bar/foo.jsx'];
          text = 'foo';
          configuration.useRelativePaths = true;
        });

        it('uses a relative import path', async () => {
          expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
          `.trim());
        });
      });
    });
  });

  describe('#addImports', () => {
    let subject;
    let resolvedImports;
    let result;

    beforeEach(() => {
      subject = async () => {
        await setup();
        result = await new Importer(text.split('\n'), pathToCurrentFile, process.cwd()).addImports(resolvedImports);
        return result.fileContent;
      };
    });

    describe('when adding one import', () => {
      beforeEach(() => {
        text = 'foo';
        existingFiles = ['./star/foo.js'];
        resolvedImports = {
          foo: './star/foo',
        };
      });

      it('adds imports based on variable name and import path', async () => {
        expect(await subject()).toEqual(`
import foo from './star/foo';

foo
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Added import for `foo`']);
      });

      describe('when the resolved import is named', () => {
        beforeEach(() => {
          readFile.mockImplementation(() => Promise.resolve('const foo = "foo"; export { foo };'));
        });

        it('adds imports based on variable name and import path', async () => {
          expect(await subject()).toEqual(`
import { foo } from './star/foo';

foo
          `.trim());
        });
      });
    });

    describe('when adding multiple imports', () => {
      beforeEach(() => {
        text = 'foo; bar;';
        resolvedImports = {
          foo: 'star/foo',
          bar: 'star/bar',
        };
      });

      it('adds imports based on variable name and import path', async () => {
        expect(await subject()).toEqual(`
import bar from 'star/bar';
import foo from 'star/foo';

foo; bar;
        `.trim());
      });

      it('displays a message', async () => {
        expect(result.messages).toEqual(['Added 2 imports']);
      });
    });

    describe('when adding multiple imports belonging to the same module', () => {
      beforeEach(() => {
        text = 'foo; bar;';
        resolvedImports = {
          foo: {
            importPath: './star/foo',
            isNamedExport: true,
          },
          bar: {
            importPath: './star/foo',
            isNamedExport: true,
          },
        };
      });

      it('adds imports', async () => {
        expect(await subject()).toEqual(`
import { bar, foo } from './star/foo';

foo; bar;
        `.trim());
      });

      it('displays a message', async () => {
        expect(result.messages).toEqual(['Added 2 imports']);
      });
    });

    describe('when adding one import with additional data', () => {
      beforeEach(() => {
        text = 'foo';
        existingFiles = ['./star/foo.js'];
        resolvedImports = {
          foo: {
            importPath: './star/foo',
            isNamedExport: false,
          },
        };
      });

      it('adds import based on variable name and import path', async () => {
        expect(await subject()).toEqual(`
import foo from './star/foo';

foo
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Added import for `foo`']);
      });

      describe('when the resolved import exists also as a named', () => {
        beforeEach(() => {
          readFile.mockImplementation(() => Promise.resolve(`
            export { foo };
            export default function() {};
          `));
        });

        it('adds import based on resolved data provided', async () => {
          expect(await subject()).toEqual(`
import foo from './star/foo';

foo
          `.trim());
        });
      });
    });
  });

  describe('#fixImports', () => {
    let subject;
    let result;

    beforeEach(() => {
      subject = async () => {
        await setup();
        result = await new Importer(text.split('\n'), pathToCurrentFile, process.cwd()).fixImports();
        return result.fileContent;
      };
    });

    describe('when no undefined variables exist', () => {
      beforeEach(() => {
        text = `
const foo = require('foo');

foo();
        `.trim();
      });

      it('leaves the buffer unchanged', async () => {
        expect(await subject()).toEqual(text);
      });

      it('displays no message', async () => {
        await subject();
        expect(result.messages).toEqual([]);
      });
    });

    describe('with a namespaced import', () => {
      beforeEach(() => {
        text = `
import * as foo from 'foo';

foo.bar();
        `.trim();
      });

      it('leaves the buffer unchanged', async () => {
        expect(await subject()).toEqual(text);
      });

      it('displays no message', async () => {
        await subject();
        expect(result.messages).toEqual([]);
      });
    });

    describe('when the file can not be parsed', () => {
      beforeEach(() => {
        text = `
return if sd([
        `.trim();
      });

      it('leaves the buffer unchanged', async () => {
        expect(await subject()).toEqual(text);
      });

      it('displays an error message', async () => {
        await subject();
        expect(result.messages).toEqual([
          "SyntaxError: 'return' outside of function (1:0)",
        ]);
      });
    });

    describe('when one undefined variable exists', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx'];
        text = 'foo();';
      });

      it('imports that variable', async () => {
        expect(await subject()).toEqual(`
import foo from './bar/foo';

foo();
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(["Imported foo from './bar/foo'"]);
      });

      describe('when there is whitespace at the top', () => {
        beforeEach(() => {
          text = `

foo();`;
        });

        it('puts imports at the top', async () => {
          expect(await subject()).toEqual(`
import foo from './bar/foo';

foo();
          `.trim());
        });
      });

      describe('when that variable is a global', () => {
        beforeEach(() => {
          configuration.globals = ['foo'];
        });

        it('does not import anything', async () => {
          expect(await subject()).toEqual(text);
        });
      });

      describe(
        'when that import already exists as a side-effect import',
        () => {
          beforeEach(() => {
            text = `
import './bar/foo';

foo();
          `.trim();
          });

          it('changes the import', async () => {
            expect(await subject()).toEqual(`
import foo from './bar/foo';

foo();
          `.trim());
          });

          it('displays a message', async () => {
            await subject();
            expect(result.messages).toEqual(["Imported foo from './bar/foo'"]);
          });
        },
      );
    });

    describe('with a module exporting types and names', () => {
      beforeEach(() => {
        existingFiles = ['star/foo.js'];
        readFile.mockImplementation(() => Promise.resolve(`
          export default function() {};
          const bar = 'bar';
          export { bar };
          export type Baz = {};
          export type Faz = {};
        `));
      });

      describe('when one undefined type exists', () => {
        beforeEach(() => {
          text = 'Baz';
        });

        it('imports that type', async () => {
          expect(await subject()).toEqual(`
import type { Baz } from './star/foo';

Baz
          `.trim());
        });

        it('displays a message', async () => {
          await subject();
          expect(result.messages).toEqual(["Imported { Baz } from './star/foo'"]);
        });
      });

      describe('when a type import is set and undefined variables exists', () => {
        beforeEach(() => {
          text = `
import type { Baz } from './star/foo';

bar: Baz;
foo();
          `.trim();
        });

        it('moves the type prefix inside brackets and adds the named and default imports', async () => {
          expect(await subject()).toEqual(`
import foo, { type Baz, bar } from './star/foo';

bar: Baz;
foo();
          `.trim());
        });
      });
    });

    describe('when there is one `moduleSideEffectImports`', () => {
      beforeEach(() => {
        existingFiles = [];
        text = 'foo();';
        configuration.moduleSideEffectImports = () => ['surstromming'];
      });

      it('imports those modules', async () => {
        expect(await subject()).toEqual(`
import 'surstromming';

foo();
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(["Imported 'surstromming'"]);
      });

      describe('when that import is already in the list', () => {
        beforeEach(() => {
          text = `
import 'surstromming';

foo();
          `.trim();
        });

        it('leaves the buffer untouched', async () => {
          expect(await subject()).toEqual(text);
        });

        it('has no message', async () => {
          await subject();
          expect(result.messages).toEqual([]);
        });
      });
    });

    describe('when there are multiple `moduleSideEffectImports`', () => {
      beforeEach(() => {
        existingFiles = [];
        text = 'foo();';
        configuration.moduleSideEffectImports = () => [
          'surstromming',
          'pitepalt',
        ];
      });

      it('imports those modules', async () => {
        expect(await subject()).toEqual(`
import 'pitepalt';
import 'surstromming';

foo();
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Added 2 imports']);
      });
    });

    describe('when multiple undefined variables exist', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx', 'bar.js'];
        text = 'var a = foo + bar;';
      });

      it('imports all variables', async () => {
        expect(await subject()).toEqual(`
import bar from './bar';
import foo from './bar/foo';

var a = foo + bar;
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Added 2 imports']);
      });
    });

    describe('when undefined variables are used multiple times', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx', 'bar.js'];
        text = `
var a = foo + bar;
var b = bar + foo;
        `.trim();
      });

      it('imports all variables', async () => {
        expect(await subject()).toEqual(`
import bar from './bar';
import foo from './bar/foo';

var a = foo + bar;
var b = bar + foo;
        `.trim());
      });

      it('displays a message with the right count', async () => {
        await subject();
        expect(result.messages).toEqual(['Added 2 imports']);
      });
    });

    describe('when a React component is not imported', () => {
      beforeEach(() => {
        packageDependencies = ['react'];
        existingFiles = ['bar/foo.jsx'];
        text = `
import React from 'react';

const foo = <Foo/>;
        `.trim();
      });

      it('imports that component', async () => {
        expect(await subject()).toEqual(`
import React from 'react';

import Foo from './bar/foo';

const foo = <Foo/>;
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(["Imported Foo from './bar/foo'"]);
      });
    });

    describe('when a React component is already imported', () => {
      beforeEach(() => {
        packageDependencies = ['react'];
        text = `
import React from 'react';

import Foo from 'bar/foo';

const foo = <Foo/>;
        `.trim();
      });

      it('does not remove any imports', async () => {
        expect(await subject()).toEqual(text);
      });

      it('does not display any message', async () => {
        await subject();
        expect(result.messages).toEqual([]);
      });
    });

    describe('when an implicit React import is missing', () => {
      beforeEach(() => {
        text = 'var a = <span/>;';
      });

      describe('when react is not available', () => {
        it('leaves the buffer unchanged', async () => {
          expect(await subject()).toEqual(text);
        });
      });

      describe('when react is available', () => {
        beforeEach(() => {
          packageDependencies = ['react'];
        });

        it('imports React', async () => {
          expect(await subject()).toEqual(`
import React from 'react';

var a = <span/>;
          `.trim());
        });

        it('displays a message', async () => {
          await subject();
          expect(result.messages).toEqual(["Imported React from 'react'"]);
        });
      });
    });

    describe('when one unused import exists', () => {
      beforeEach(() => {
        text = `
import foo from 'bar/foo';
import zar from 'foo/zar';

zar
        `.trim();
      });

      it('removes that import', async () => {
        expect(await subject()).toEqual(`
import zar from 'foo/zar';

zar
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Removed `foo`.']);
      });

      describe('when that import is the last one', () => {
        beforeEach(() => {
          text = `
import foo from 'bar/foo';

bar
          `.trim();
        });

        it('removes that import and leaves no whitespace', async () => {
          expect(await subject()).toEqual(`
bar
          `.trim());
        });

        describe('and there is a comment above', () => {
          beforeEach(() => {
            text = `
// I'm a comment
import foo from 'bar/foo';

bar
            `.trim();
          });

          it('removes that import and leaves no whitespace', async () => {
            expect(await subject()).toEqual(`
// I'm a comment
bar
            `.trim());
          });

          describe('with whitespace after the comment', () => {
            beforeEach(() => {
              text = `
// I'm a comment

import foo from 'bar/foo';

bar
              `.trim();
            });

            it('removes that import and leaves one newline', async () => {
              expect(await subject()).toEqual(`
// I'm a comment

bar
              `.trim());
            });
          });
        });

        describe('and there is no previous whitespace', () => {
          beforeEach(() => {
            text = `
import foo from 'bar/foo';
bar
            `.trim();
          });

          it('removes that import and leaves no whitespace', async () => {
            expect(await subject()).toEqual(`
bar
            `.trim());
          });
        });
      });
    });

    describe('when the file consists of one line only', () => {
      describe('and that line is an import', () => {
        beforeEach(() => {
          text = "import foo from 'bar/foo';";
        });

        it('removes that import and leaves no whitespace', async () => {
          expect(await subject()).toEqual('');
        });

        it('displays a message', async () => {
          await subject();
          expect(result.messages).toEqual(['Removed `foo`.']);
        });
      });

      describe('and that line is not an import', () => {
        beforeEach(() => {
          text = 'const a = <span/>;';
        });

        it('leaves the file intact', async () => {
          expect(await subject()).toEqual(text);
        });

        it('does not tell you it removed `a`', async () => {
          await subject();
          expect(result.messages).toEqual([]);
        });
      });
    });

    describe('when multiple unused imports exist', () => {
      beforeEach(() => {
        text = `
import bar from 'foo/bar';
import baz from 'bar/baz';
import foo from 'bar/foo';

baz
        `.trim();
      });

      it('removes all unused imports', async () => {
        expect(await subject()).toEqual(`
import baz from 'bar/baz';

baz
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Removed 2 imports.']);
      });
    });

    describe('when an unused import and an undefined import exists', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx'];
        text = `
import bar from 'foo/bar';

foo
        `.trim();
      });

      it('removes the unused import and adds the missing one', async () => {
        expect(await subject()).toEqual(`
import foo from './bar/foo';

foo
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(["Imported foo from './bar/foo'. Removed `bar`."]);
      });
    });

    describe('when a named import has an unused variable', () => {
      beforeEach(() => {
        text = `
import { bar, foo } from 'baz';

bar
        `.trim();
      });

      it('removes that variable from the named imports list', async () => {
        expect(await subject()).toEqual(`
import { bar } from 'baz';

bar
        `.trim());
      });

      it('displays a message', async () => {
        await subject();
        expect(result.messages).toEqual(['Removed `foo`.']);
      });
    });

    describe('when the last import is removed from a named import', () => {
      beforeEach(() => {
        text = `
import bar from 'bar';
import { foo } from 'baz';

bar
        `.trim();
      });

      it('removes the whole import', async () => {
        expect(await subject()).toEqual(`
import bar from 'bar';

bar
        `.trim());
      });
    });

    describe(
      'when an unused variable that shares its name with an import exists',
      () => {
        beforeEach(() => {
          text = `
import uuid from 'uuid';

function bar() {
  return uuid.v4();
}

export default function foo() {
  const things = {
    uuid: bar(),
    henric: 'is cool',
  };

  const { uuid, henric } = things;
  return henric;
}
        `.trim();
        });

        it('does not remove the import', async () => {
          expect(await subject()).toEqual(text);
        });

        it('does not display any message', async () => {
          await subject();
          expect(result.messages).toEqual([]);
        });
      },
    );
  });

  describe('#rewriteImports', () => {
    let subject;

    beforeEach(() => {
      existingFiles = ['baz.jsx'];
      configuration.namedExports = {
        bar: ['foo'],
      };
      packageDependencies = ['bar'];
      pathToCurrentFile = 'bilbo/frodo.js';

      subject = async () => {
        await setup();
        const result = await new Importer(text.split('\n'), pathToCurrentFile, process.cwd()).rewriteImports();
        return result.fileContent;
      };
    });

    describe('when imports exist', () => {
      beforeEach(() => {
        text = `
import baz from '../baz';
import bar, { foo } from 'bar';

bar
        `.trim();
      });

      describe('and we are not changing anything in config', () => {
        it('only sorts and groups imports', async () => {
          expect(await subject()).toEqual(`
import bar, { foo } from 'bar';

import baz from '../baz';

bar
          `.trim());
        });
      });

      describe('and `groupImports` is false', () => {
        beforeEach(() => {
          configuration.groupImports = false;
        });

        it('sorts imports', async () => {
          expect(await subject()).toEqual(`
import bar, { foo } from 'bar';
import baz from '../baz';

bar
          `.trim());
        });
      });

      describe('and we are switching declarationKeyword to `const`', () => {
        beforeEach(() => {
          configuration.declarationKeyword = 'const';
        });

        it('groups, sorts, and changes imports to use `const`', async () => {
          expect(await subject()).toEqual(`
const bar = require('bar');
const { foo } = require('bar');

const baz = require('../baz');

bar
          `.trim());
        });
      });
    });

    describe('when imports use a mix of relative and normal paths', () => {
      beforeEach(() => {
        text = `
import bar, { foo } from 'bar';
import baz from '../baz';

bar
        `.trim();
      });

      describe('and we are turning relative paths off', () => {
        beforeEach(() => {
          configuration.useRelativePaths = false;
        });

        it('sorts, groups, and changes to absolute paths', async () => {
          expect(await subject()).toEqual(`
import bar, { foo } from 'bar';

import baz from 'baz';

bar
          `.trim());
        });
      });
    });

    describe('when imports use normal paths', () => {
      beforeEach(() => {
        text = `
import bar, { foo } from 'bar';
import baz from 'baz';

bar
        `.trim();
      });

      describe('and we are turning relative paths on', () => {
        beforeEach(() => {
          configuration.useRelativePaths = true;
        });

        it('sorts, groups, and changes to relative paths', async () => {
          expect(await subject()).toEqual(`
import bar, { foo } from 'bar';

import baz from '../baz';

bar
          `.trim());
        });
      });
    });

    describe('when an import is of the side-effect type', () => {
      describe('and is by itself', () => {
        beforeEach(() => {
          text = `
import 'bar.html';

bar
          `.trim();
        });

        it('is passed through unchanged', async () => {
          expect(await subject()).toEqual(`
import 'bar.html';

bar
          `.trim());
        });
      });

      describe('and others are present', () => {
        beforeEach(() => {
          text = `
import bar, { foo } from 'bar';
import baz from 'baz';
import 'bar.html';

bar
          `.trim();
        });

        it('is passed through unchanged and sorted to the top', async () => {
          expect(await subject()).toEqual(`
import 'bar.html';

import bar, { foo } from 'bar';

import baz from '../baz';

bar
          `.trim());
        });
      });
    });
  });

  describe('#goto', () => {
    let subject;
    let result;

    beforeEach(() => {
      subject = async () => {
        await setup();
        result = await new Importer(text.split('\n'), pathToCurrentFile, process.cwd()).goto(word);
        return result.goto;
      };
    });

    describe('with a variable name that will resolve', () => {
      beforeEach(() => {
        existingFiles = ['bar/foo.jsx'];
      });

      it('opens the file', async () => {
        expect(await subject()).toEqual(path.join(process.cwd(), 'bar/foo.jsx'));
      });

      it('does not show a message', async () => {
        await subject();
        expect(result.messages).toEqual([]);
      });
    });

    describe('with a variable name that will not resolve', () => {
      beforeEach(() => {
        existingFiles = ['bar/goo.jsx'];
      });

      it('opens nothing', async () => {
        expect(await subject()).toBeUndefined();
      });

      it('shows a message', async () => {
        await subject();
        expect(result.messages).toEqual(['No JS module found for `foo`']);
      });

      describe('when there is a current import for the variable', () => {
        beforeEach(() => {
          text = `
import foo from 'some-package';

foo
          `.trim();
        });

        describe('matching a package dependency', () => {
          beforeEach(() => {
            packageDependencies = ['some-package'];
            requireRelative.resolve.mockImplementation(() =>
              path.join(
                process.cwd(),
                'node_modules/some-package/some-package-main.jsx',
              ));
          });

          it('opens the package main file', async () => {
            expect(await subject()).toEqual(path.join(
              process.cwd(),
              'node_modules/some-package/some-package-main.jsx',
            ));
          });
        });
      });
    });

    describe(
      'with a variable name that will resolve to a package dependency',
      () => {
        beforeEach(() => {
          packageDependencies = ['foo'];
        });

        it('opens the `main` file', async () => {
          expect(await subject()).toEqual(path.join(process.cwd(), 'node_modules/foo/foo-main.jsx'));
        });
      },
    );

    describe('with a variable name matching an alias', () => {
      beforeEach(() => {
        word = 'styles';
        pathToCurrentFile = '/foo/bar/current.js';
      });

      describe('to a relative resource', () => {
        beforeEach(() => {
          configuration.aliases = { styles: './index.scss' };
        });

        it('opens the file relative to the file being edited', async () => {
          expect(await subject()).toEqual('/foo/bar/index.scss');
        });
      });

      describe('to an absolute resource', () => {
        beforeEach(() => {
          configuration.aliases = { styles: 'stylez' };
          packageDependencies = ['stylez'];
        });

        it('opens the alias main file', async () => {
          expect(await subject()).toEqual(path.join(process.cwd(), 'node_modules/stylez/stylez-main.jsx'));
        });
      });
    });

    describe('with a variable name that matches multiple files', () => {
      beforeEach(() => {
        existingFiles = ['car/foo.jsx', 'bar/foo.jsx'];
      });

      describe('when the variable has not been previously imported', () => {
        it('falls back to the file sorted at the top of the list', async () => {
          expect(await subject()).toEqual(path.join(process.cwd(), 'bar/foo.jsx'));
        });
      });

      describe('when the variable has been previously imported', () => {
        describe('as a default import', () => {
          beforeEach(() => {
            text = `
import foo from './car/foo';

foo
            `.trim();
            requireRelative.resolve.mockImplementation(() =>
              path.join(
                process.cwd(),
                'car/foo.jsx',
              ));
          });

          it('opens the file', async () => {
            expect(await subject()).toEqual(path.join(process.cwd(), 'car/foo.jsx'));
          });

          describe('and there are other imports', () => {
            beforeEach(() => {
              text = `
import bar from './foo/bar';
import foo from './car/foo';
import foobar from './bar/foobar';

foo
              `.trim();
            });

            it('opens the file', async () => {
              expect(await subject()).toEqual(path.join(process.cwd(), 'car/foo.jsx'));
            });
          });
        });

        describe('as an import where the path has been modified', () => {
          beforeEach(() => {
            configuration.moduleNameFormatter = ({ moduleName }) =>
              moduleName.replace(/^\.\/car\//, '');
            text = `
import foo from 'foo';

foo
            `.trim();
          });

          it('opens the file', async () => {
            expect(await subject()).toEqual(path.join(process.cwd(), 'car/foo.jsx'));
          });
        });

        describe('as a named import', () => {
          beforeEach(() => {
            text = `
import { foo } from './car/foo';

foo
            `.trim();
          });

          it('opens the file', async () => {
            expect(await subject()).toEqual(path.join(process.cwd(), 'car/foo.jsx'));
          });
        });
      });
    });
  });
});
