import {inject} from 'vitest';
import {installOfficialRecipeSnapshot} from './registered-recipe-account-core.mjs';
installOfficialRecipeSnapshot(inject('registeredRecipeFixtureSnapshot'),inject('profileTestAccountRoot'));
