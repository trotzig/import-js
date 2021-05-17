import fs from 'fs';
import path from 'path';

import requireRelative from 'require-relative';

import parse from './parse';

function findESNamedExports(
  node,
  {
    absolutePathToFile,
  },
) {
  if (node.type === 'ExportAllDeclaration') {
    // Recurse the file referenced by the declaration
    // eslint-disable-next-line no-use-before-define
    return resolveNestedNamedExports(node, absolutePathToFile);
  }

  if (node.type !== 'ExportNamedDeclaration') {
    return [];
  }

  if (node.specifiers.length) {
    return node.specifiers.map(({ exported }) => exported.name);
  }

  if (!node.declaration) {
    return [];
  }

  if (
    node.declaration.type === 'FunctionDeclaration' ||
    node.declaration.type === 'ClassDeclaration'
  ) {
    return [node.declaration.id.name];
  }

  const result = [];

  if (!node.declaration.declarations) {
    return result;
  }

  node.declaration.declarations.forEach(({ id }) => {
    // Always check for type === 'Identifier' before adding name
    if (id.type === 'Identifier') {
      // export const foo = 'bar'
      result.push(id.name);
    } else if (id.type === 'ObjectPattern') {
      // export const { foo, bar } = something();
      id.properties.forEach((property) => {
        if (property.type === 'ObjectProperty') {
          // use value instead of key, since destructuring can remap the
          // key to a new name
          // ie. export const { foo, bar: baz } = something();
          //                     key ^^^  ^^^ value
          if (property.value.type === 'Identifier') {
            result.push(property.value.name);
          } else if (property.value.type === 'AssignmentPattern') {
            // Here's where things start getting weird
            // `with default: export const {
            //    foo,
            //    bar = {a:1,b:2}
            //  } = someObject`
            // `renamed default: export const {
            //    foo,
            //    bar: baz = {a:1,b:2}
            //  } = someObject`
            if (property.value.left.type === 'Identifier') {
              result.push(property.value.left.name);
            }
          }
        } else if (property.type === 'RestElement') {
          // export const { foo, ...rest } = something();
          result.push(property.argument.name);
        }
      });
    } else if (id.type === 'ArrayPattern') {
      // export const [ foo, bar ] = something();
      id.elements.forEach((element) => {
        if (element.type === 'Identifier') {
          result.push(element.name);
        } else if (element.type === 'RestElement') {
          // export const [ foo, ...rest ] = something();
          result.push(element.argument.name);
        }
      });
    }
  });
  return result;
}

function findFlowTypeExports(node) {
  if (node.type !== 'ExportNamedDeclaration') {
    return [];
  }

  if (!node.declaration) {
    return [];
  }

  if (node.declaration.type === 'TypeAlias') {
    return [node.declaration.id.name];
  }

  return [];
}

function findTypeScriptExports(node) {
  if (node.type !== 'ExportNamedDeclaration') {
    return [];
  }

  if (!node.declaration) {
    return [];
  }

  if (node.declaration.type === 'TSInterfaceDeclaration' ||
      node.declaration.type === 'TSTypeAliasDeclaration' ||
      node.declaration.type === 'TSEnumDeclaration') {
    return [node.declaration.id.name];
  }

  return [];
}

function resolveNestedNamedExports(node, absolutePathToFile) {
  if (node.type === 'ConditionalExpression') {
    // Potential ternary-style export - we pick the first one
    // module.exports = foo ? require('a') : require('b');
    return resolveNestedNamedExports(node.consequent, absolutePathToFile);
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'StringLiteral'
  ) {
    // module.exports = require('someOtherFile.js');
    const pathToRequiredFile = requireRelative.resolve(
      node.arguments[0].value,
      path.dirname(absolutePathToFile),
    );

    const requiredFileContent = fs.readFileSync(pathToRequiredFile, 'utf8');
    // eslint-disable-next-line no-use-before-define
    const { named } = findExports(requiredFileContent, pathToRequiredFile);
    return named;
  } else if (node.type === 'ExportAllDeclaration') {
    const pathToRequiredFile = requireRelative.resolve(
      node.source.value,
      path.dirname(absolutePathToFile),
    );

    const requiredFileContent = fs.readFileSync(pathToRequiredFile, 'utf8');
    // eslint-disable-next-line no-use-before-define
    const { named } = findExports(requiredFileContent, pathToRequiredFile);
    return named;
  }
  return undefined;
}

function findCommonJSExports(
  node,
  {
    definedNames,
    absolutePathToFile,
    aliasesForExports,
  },
) {
  if (node.type !== 'ExpressionStatement') {
    return [];
  }
  if (
    node.expression.type === 'CallExpression' &&
    node.expression.callee.type === 'MemberExpression' &&
    aliasesForExports.has(node.expression.callee.object.name) &&
    node.expression.callee.property.name === 'use' &&
    node.expression.arguments.length &&
    node.expression.arguments[0].type === 'Identifier'
  ) {
    // exports.use(foo);
    return [node.expression.arguments[0].name];
  }
  if (
    node.expression.type === 'CallExpression' &&
    node.expression.callee.type === 'MemberExpression' &&
    node.expression.callee.object.name === 'Object' &&
    node.expression.callee.property.name === 'defineProperty' &&
    node.expression.arguments.length > 1 &&
    node.expression.arguments[0].type === 'Identifier' &&
    aliasesForExports.has(node.expression.arguments[0].name) &&
    node.expression.arguments[1].type === 'StringLiteral'
  ) {
    // Object.defineProperty(exports, 'foo', { ... });
    return [node.expression.arguments[1].value];
  }
  const { left, right } = node.expression;
  if (!left || !right) {
    return [];
  }
  if (
    (left.object &&
      left.object.name === 'module' &&
      left.property.name === 'exports') ||
    aliasesForExports.has(left.name)
  ) {
    const nestedNamed = resolveNestedNamedExports(right, absolutePathToFile);
    if (nestedNamed) {
      return nestedNamed;
    }
    // module.exports = { foo: 'foo' };
    if (right.type === 'ObjectExpression') {
      return right.properties.map(({ key }) => key.name).filter(Boolean);
    }
    if (right.type === 'Identifier') {
      return definedNames[right.name] || [];
    }
  }

  if (!left.object || !left.property) {
    return [];
  }

  if (
    left.object.type === 'MemberExpression' &&
    left.object.object.name === 'module' &&
    left.object.property.name === 'exports'
  ) {
    // module.exports.foo = 'bar';
    return [left.property.name];
  }

  if (
    left.type === 'MemberExpression' &&
    left.object.type === 'Identifier' &&
    aliasesForExports.has(left.object.name)
  ) {
    // exports.foo = 'bar';
    return [left.property.name];
  }

  return [];
}

function findDefinedNames(node, definedNames) {
  if (node.type === 'ExpressionStatement') {
    const { left, right } = node.expression;
    if (left && right) {
      if (left.object) {
        (definedNames[left.object.name] || []).push(left.property.name);
      }
    }
  }
  if (node.type !== 'VariableDeclaration') {
    return;
  }
  node.declarations.forEach(({ id, init }) => {
    if (!init) {
      return;
    }
    if (init.type === 'ObjectExpression') {
      // eslint-disable-next-line no-param-reassign
      definedNames[id.name] = init.properties
        .map(({ key }) => key && key.name)
        .filter(Boolean);
    } else if (init.type === 'FunctionExpression') {
      definedNames[id.name] = []; // eslint-disable-line no-param-reassign
    }
  });
}

/**
 * This function will find variable declarations where `exports` is redefined as
 * something else. E.g.
 *
 * const moduleName = exports;
 */
function findAliasesForExports(nodes) {
  const result = new Set(['exports']);
  nodes.forEach((node) => {
    if (node.type !== 'VariableDeclaration') {
      return;
    }
    node.declarations.forEach(({ id, init }) => {
      if (!init) {
        return;
      }
      if (init.type !== 'Identifier') {
        return;
      }
      if (init.name !== 'exports') {
        return;
      }
      // We have something like
      // var foo = exports;
      result.add(id.name);
    });
  });
  return result;
}

function findNamedExports(
  nodes,
  {
    absolutePathToFile,
    definedNames,
    aliasesForExports,
  },
) {
  const result = [];
  nodes.forEach((node) => {
    result.push(...findESNamedExports(node, {
      absolutePathToFile,
    }));
    result.push(...findCommonJSExports(node, {
      definedNames,
      absolutePathToFile,
      aliasesForExports,
    }));
    // Treat TypeScript exports as first-class citizens because
    // its import syntax is the same as ES module import syntax.
    result.push(...findTypeScriptExports(node));
  });
  return result;
}

function findTypeExports(nodes) {
  const result = [];
  nodes.forEach((node) => {
    result.push(...findFlowTypeExports(node));
  });
  return result;
}

function hasDefaultExport(nodes) {
  return nodes.some((node) => {
    if (node.type === 'ExportDefaultDeclaration') {
      return true;
    }
    if (node.type !== 'ExpressionStatement') {
      return false;
    }
    // Potential CommonJS export
    const { left, right } = node.expression;
    if (!left || !right) {
      return false;
    }
    if (left.name === 'exports') {
      return true;
    }
    if (!left.object || !left.property) {
      // foo = 'bar';
      return false;
    }
    return left.object.name === 'module' && left.property.name === 'exports';
  });
}

const DEFAULT_EXPORT_PATTERN = /\smodule\.exports\s*=\s*(\w+)/;
function findRawDefaultExport(data) {
  const match = data.match(DEFAULT_EXPORT_PATTERN);
  if (match) {
    return match[1];
  }
  return undefined;
}

function findRawNamedExports(data) {
  const result = new Set();
  const pattern = /^exports\.(\w+)\s*=\s*[\w.]+;$/gm;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(data)) !== null) {
    const name = match[1];
    if (name !== 'default') {
      result.add(name);
    }
  }
  return Array.from(result);
}

function findRootNodes(ast) {
  const realRootNodes = ast.program.body;
  if (realRootNodes.length > 1) {
    return realRootNodes;
  }
  try {
    // Try finding the function body from this case:
    //
    //   (function () {
    //     module.exports = { foo: 'foo' };
    //   }.call(this));
    //
    const { callee } = realRootNodes[0].expression;
    if (callee.object) {
      return callee.object.body.body;
    }
    return callee.body.body;
  } catch (e) {
    // ignore
  }
  return realRootNodes;
}

function findUnnamedExports(data) {
  const regex = /customElements\.define\s*\(\s*['"]([0-9a-z-]+)['"]\s*,\s*[a-zA-Z0-9_$]+\s*\)/g
  return Array.from(data.matchAll(regex)).map(t => `<${t[1]}>`)
}

export default function findExports(data, absolutePathToFile) {
  if (/\.json$/.test(absolutePathToFile)) {
    return {
      named: Object.keys(JSON.parse(data)),
      typed: [],
      hasDefault: true,
    };
  }
  const ast = parse(data, absolutePathToFile);
  const rootNodes = findRootNodes(ast);
  const aliasesForExports = findAliasesForExports(rootNodes);
  const definedNames = {};
  rootNodes.forEach((node) => {
    findDefinedNames(node, definedNames);
  });
  const named = findNamedExports(rootNodes, {
    absolutePathToFile,
    definedNames,
    aliasesForExports,
  });
  const typed = findTypeExports(rootNodes);
  let hasDefault = hasDefaultExport(rootNodes) ||
                   aliasesForExports.size > 1 ||
                   named.indexOf('default') !== -1;
  if (!hasDefault) {
    const rawExportedId = findRawDefaultExport(data);
    hasDefault = !!rawExportedId;
    if (!named.length) {
      named.push(...(definedNames[rawExportedId] || []));
    }
  }
  if (!named.length) {
    named.push(...findRawNamedExports(data));
  }

  const unnamed = findUnnamedExports(data)
  
  return {
    named: named.concat(unnamed),
    typed,
    hasDefault,
  };
}
