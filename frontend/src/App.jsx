import { useState } from 'react';
import './App.css';
import Aside from './layouts/Aside/Aside';
import { Header } from './layouts/Header/Header';
import { Home } from './pages/Home/Home';
import { YoutubeList } from './pages/Youtube/YoutubeList';
import { ContentCreation } from './pages/ContentCreation/ContentCreation';

function App() {
  const [page, setPage] = useState('home');

  function navigate(nextPage) {
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
            {page === 'content-creation' && <ContentCreation onNavigate={navigate}/>} 
            {page === 'home' && <Home onNavigate={navigate}/>}                
        </main>
    </div>
  );
}

export default App
