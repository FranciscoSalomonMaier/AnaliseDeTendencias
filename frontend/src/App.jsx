import { useState } from 'react';
import './App.css';
import Aside from './layouts/Aside/Aside';
import { Header } from './layouts/Header/Header';
import { Home } from './pages/Home/Home';
import { TrendingTopics } from './pages/TrendingTopics/TrendingTopics';
import { YoutubeList } from './pages/Youtube/YoutubeList';
import { ContentCreation } from './pages/ContentCreation/ContentCreation';
import { ContentLibrary } from './pages/ContentLibrary/ContentLibrary';

function App() {
  const [page, setPage] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const route = params.get('page');
    return route === 'content-creation' || route === 'youtube-list' || route === 'content-library' || route === 'trending-topics' ? route : 'home';
  });
  const [creationSeed, setCreationSeed] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('page') !== 'content-creation') return null;
    return {
      source: params.get('source'),
      generationId: params.get('generationId') ?? '',
      trendId: params.get('trendId') ?? '',
      videoId: params.get('videoId') ?? '',
      regionCode: params.get('regionCode') ?? 'BR',
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
      const params = new URLSearchParams({
        page: 'content-creation',
        source: payload?.source ?? '',
        generationId: payload?.generationId ?? '',
        trendId: payload?.trendId ?? '',
        videoId: payload?.videoId ?? '',
        regionCode: payload?.regionCode ?? 'BR',
        title: payload?.title ?? '',
        summary: payload?.summary ?? '',
        referenceTitle: payload?.referenceTitle ?? '',
        category: payload?.category ?? '',
        channel: payload?.channel ?? '',
      });
      (payload?.tags ?? []).forEach((tag) => params.append('tag', tag));
      window.history.pushState({}, '', `${window.location.pathname}?${params}`);
    } else if (nextPage === 'youtube-list' || nextPage === 'content-library' || nextPage === 'trending-topics') {
      window.history.pushState({}, '', `${window.location.pathname}?page=${nextPage}`);
    } else {
      window.history.pushState({}, '', window.location.pathname);
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
        <main className="min-w-0 flex-1">
            <Header/>
            {page === 'trending-topics' && <TrendingTopics/>}
            {page === 'youtube-list' && <YoutubeList onNavigate={navigate}/>} 
            {page === 'content-creation' && <ContentCreation onNavigate={navigate} analysis={creationSeed}/>} 
            {page === 'content-library' && <ContentLibrary onNavigate={navigate}/>}
            {page === 'home' && <Home onNavigate={navigate}/>}                
        </main>
    </div>
  );
}

export default App
