#!/usr/bin/env node
import { extractToRegistries } from '../manifest/extract';
import { buildManifest } from '../manifest/build';

async function main() {
  console.log('Extracting capabilities from source...');
  const extraction = extractToRegistries();
  console.log(`Extracted ${extraction.capabilities} capabilities and ${extraction.intents} resource intents`);
  
  console.log('Building manifest...');
  const result = await buildManifest();
  if ((result as any).ok === false) {
    console.error('Manifest validation failed:', (result as any).errors);
    process.exit(1);
  }
  console.log('Manifest built at', (result as any).manifestPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


