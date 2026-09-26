/** Throwaway: renders the 音效 settings panel on its own so the layout can be looked at.
 *  ?muted=1 shows the muted state. Delete with tmp-audio-ui.html. */
import { createRoot } from 'react-dom/client';
import { AppProvider } from './src/context/AppContext';
import { AudioCategory } from './src/components/UI/settings/AudioCategory';


createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <div className="bg-white p-10 max-w-2xl text-island-navy">
      <AudioCategory />
    </div>
  </AppProvider>,
);
