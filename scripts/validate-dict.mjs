#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StressDictionary } from '../dist/dict.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dictionaryPath = path.resolve(process.argv[2] ?? path.join(here, '..', 'data/dict.bin'));
const dictionary = StressDictionary.load(dictionaryPath);
const report = dictionary.validateAll();
console.log(JSON.stringify({ path: dictionaryPath, ...report }, null, 2));
if (report.invalidEntries > 0) process.exitCode = 1;
