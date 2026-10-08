// "Data & method" page entry (methods.html): language from ?lang=, content from world.json.
import { loadWorld } from './data/load';
import { langFromSearch, renderLoadError, renderMethodsPage } from './ui/methodsPage';

const root = document.getElementById('methods');
if (root) {
  const lang = langFromSearch(location.search);
  document.documentElement.lang = lang;
  loadWorld()
    .then((world) => renderMethodsPage(root, world, lang))
    .catch((err: unknown) => {
      console.error(err);
      renderLoadError(root, lang);
    });
}
