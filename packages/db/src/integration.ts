import type { AstroIntegration } from 'astro';
import { vitePluginDb } from './vite-plugin-db.js';
import { vitePluginInjectEnvTs } from './vite-plugin-inject-env-ts.js';
import { typegen } from './typegen.js';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { getLocalDbUrl, DB_PATH } from './consts.js';
import { createLocalDatabaseClient, setupDbTables } from './internal.js';
import { astroConfigWithDbSchema } from './config.js';
import { getAstroStudioEnv, type VitePlugin } from './utils.js';
import { appTokenError } from './errors.js';
import { errorMap } from './error-map.js';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { bold } from 'kleur/colors';

export function integration(): AstroIntegration {
	return {
		name: 'astro:db',
		hooks: {
			async 'astro:config:setup'({ logger, updateConfig, config, command }) {
				if (command === 'preview') return;

				// TODO: refine where we load collections
				// @matthewp: may want to load collections by path at runtime
				const configWithDb = astroConfigWithDbSchema.parse(config, { errorMap });
				const collections = configWithDb.db?.collections ?? {};
				const studio = configWithDb.db?.studio ?? false;
				if (!studio && Object.values(collections).some((c) => c.writable)) {
					logger.warn(
						`Writable collections should only be used with Astro Studio. Did you set the ${bold(
							'studio'
						)} flag in your astro config?`
					);
				}

				let dbPlugin: VitePlugin;
				if (studio && command === 'build') {
					const appToken = getAstroStudioEnv().ASTRO_STUDIO_APP_TOKEN;
					if (!appToken) {
						logger.error(appTokenError);
						process.exit(0);
					}
					dbPlugin = vitePluginDb({
						connectToStudio: true,
						collections,
						appToken
					});
				} else {
					const dbUrl = getLocalDbUrl(config.root);
					if (existsSync(dbUrl)) {
						await rm(dbUrl);
					}
					await mkdir(dirname(fileURLToPath(dbUrl)), { recursive: true });
					await writeFile(dbUrl, '');

					const db = await createLocalDatabaseClient({
						collections,
						dbUrl: dbUrl.href,
						seeding: true,
					});
					await setupDbTables({
						db,
						collections,
						data: configWithDb.db?.data,
						logger,
						mode: command === 'dev' ? 'dev' : 'build',
					});
					logger.info('Collections set up 🚀');

					dbPlugin = vitePluginDb({ connectToStudio: false, collections, dbUrl: dbUrl.href });
				}

				updateConfig({
					vite: {
						assetsInclude: [DB_PATH],
						plugins: [dbPlugin, vitePluginInjectEnvTs(config)],
					},
				});
				await typegen({ collections, root: config.root });
			},
		},
	};
}