import { useState } from 'react';
import './App.css';
import Aside from './layouts/Aside/Aside';
import { Header } from './layouts/Header/Header';
import { Home } from './pages/Home/Home';
import { YoutubeList } from './pages/Youtube/YoutubeList';
import { ContentCreation } from './pages/ContentCreation/ContentCreation';

function App() {
  const [page, setPage] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('page') === 'content-creation' ? 'content-creation' : 'home';
  });
  const [creationSeed, setCreationSeed] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') !== 'content-creation') return null;
    return {
      source: params.get('source'),
      title: params.get('title') ?? '',
      summary: params.get('summary') ?? '',
      referenceTitle: params.get('referenceTitle') ?? '',
      category: params.get('category') ?? '',
      channel: params.get('channel') ?? '',
      tags: params.getAll('tag'),
    };
  });

  function navigate(nextPage, payload = null) {
    if (nextPage === 'content-creation') {
      setCreationSeed(payload);
    }
    setPage(nextPage);
  }

  return (
    <div className="p-0 m-0 flex">
        <Aside currentPage={page} onNavigate={navigate}>
            <Aside.Header/>
            <Aside.Body currentPage={page} onNavigate={navigate}/>
            <Aside.Bottom/>
        </Aside>
        <main className="flex-1">
            <Header/>
            {page === 'youtube-list' && <YoutubeList onNavigate={navigate}/>} 
            {page === 'content-creation' && <ContentCreation onNavigate={navigate} analysis={creationSeed}/>} 
            {page === 'home' && <Home onNavigate={navigate}/>}                
        </main>
    </div>
  );
}

export default App
