import {resolve} from 'node:path';
import {snapshotOfficialRecipe} from './registered-recipe-account-core.mjs';
export default async function setup(project){project.provide('registeredRecipeFixtureSnapshot',await snapshotOfficialRecipe(resolve(project.config.root,'..')));}
