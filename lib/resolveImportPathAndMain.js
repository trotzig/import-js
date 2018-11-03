// @flow
import fs from 'fs';
import path from 'path';

import escapeRegExp from 'lodash/escapeRegExp';

import FileUtils from './FileUtils';
import forwardSlashes from './forwardSlashes';

function findIndex(directory: string): ?string {
  return ['index.js', 'index.jsx', 'index.ts', 'index.tsx', 'index.coffee'].find((indexFile: string): boolean =>
    fs.existsSync(path.join(directory, indexFile)));
}

function resolveForPackage(
  filePath: string,
  workingDirectory: string,
): ?Array<?string> {
  if (!filePath.endsWith('/package.json')) {
    return null;
  }

  const json = FileUtils.readJsonFile(path.join(workingDirectory, filePath));
  if (!json) {
    return [null, null];
  }

  let mainFile = json.main;
  const match = filePath.match(/(.*)[\\/]package\.json/);
  if (!match) {
    return [null, null];
  }

  const matchPackage = match[1];

  if (!mainFile) {
    const indexFile = findIndex(path.join(workingDirectory, matchPackage));
    if (!indexFile) {
      return [null, null];
    }
    mainFile = indexFile;
  }

  const mainFilePath = path.join(workingDirectory, matchPackage, mainFile);
  if (fs.existsSync(mainFilePath) && fs.lstatSync(mainFilePath).isDirectory()) {
    // The main in package.json refers to a directory, so we want to
    // resolve it to an index file.
    const indexFile = findIndex(mainFilePath);
    if (indexFile) {
      mainFile += `/${indexFile}`;
    }
  }

  return [matchPackage, forwardSlashes(path.normalize(mainFile))];
}

export default function resolveImportPathAndMain(
  filePath: string,
  stripFileExtensions: Array<string>,
  workingDirectory: string = process.cwd(),
): Array<?string> {
  const resolvedForPackage = resolveForPackage(filePath, workingDirectory);
  if (resolvedForPackage) {
    return resolvedForPackage;
  }

  const match = filePath.match(/(.*)\/(index\.[jt]s[^/]*)$/);
  if (match) {
    return [match[1], match[2]];
  }

  if (!stripFileExtensions) {
    return [filePath, null];
  }

  const extensions = stripFileExtensions.map((ext: string): string =>
    escapeRegExp(ext));
  const importPath = filePath.replace(RegExp(`(${extensions.join('|')})$`), '');
  return [importPath, null];
}
