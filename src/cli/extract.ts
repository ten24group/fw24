#!/usr/bin/env node
import { extractToRegistries } from '../manifest/extract';

async function main() {
  console.log('Extracting capabilities and resources from source files...');
  const result = extractToRegistries();
  console.log(`Extracted ${result.capabilities} capabilities and ${result.intents} resource intents`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
