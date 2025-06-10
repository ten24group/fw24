import { build } from 'esbuild';
import path from 'path';
import fs from 'fs';

// Load all lambda entry files
const lambdaFiles = fs.readdirSync('./lambdas').filter(file => file.endsWith('.ts'));

const sharedModules = {
  config: fs.readFileSync('./shared/config.ts', 'utf8'),
  logger: fs.readFileSync('./shared/logger.ts', 'utf8'),
};

async function run() {

  for (const lambdaFile of lambdaFiles) {
    const lambdaName = path.basename(lambdaFile, '.ts');
    const lambdaPath = path.join('./lambdas', lambdaFile);

    const injectedImports = `
    import * as config from '__virtual:config';
    import * as logger from '__virtual:logger';
  `;

    const userCode = fs.readFileSync(lambdaPath, 'utf8');

    const result = await build({
      stdin: {
        contents: `${injectedImports}\n${userCode}`,
        resolveDir: process.cwd(),
        sourcefile: lambdaFile,
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      write: true,
      outfile: `dist/${lambdaName}.js`,
      plugins: [
        {
          name: 'virtual-modules',
          setup(build) {
            build.onResolve({ filter: /^__virtual:config$/ }, () => ({
              path: '__virtual:config',
              namespace: 'virtual',
            }));
            build.onResolve({ filter: /^__virtual:logger$/ }, () => ({
              path: '__virtual:logger',
              namespace: 'virtual',
            }));
            build.onLoad({ filter: /.*/, namespace: 'virtual' }, ({ path }) => {
              return {
                contents: sharedModules[ path.split(':')[ 1 ] as keyof typeof sharedModules ],
                loader: 'ts',
              };
            });
          },
        },
      ],
    });

    console.log(`✅ Built Lambda: ${lambdaName}`);
  }
}

run().then(() => {
  console.log('✅ Built all Lambdas');
}).catch(err => {
  console.error('❌ Error building Lambdas', err);
});