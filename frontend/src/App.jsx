import './App.css';
import Aside from './layouts/Aside/Aside';
import { Header } from './layouts/Header/Header';
import { Home } from './pages/Home/Home';

function App() {
  return (
    <div className="p-0 m-0 flex">
        <Aside>
            <Aside.Header/>
            <Aside.Body/>
            <Aside.Bottom/>
        </Aside>
        <main className="flex-1">
            <Header/>
            <Home/>                
        </main>
    </div>
  );
}

export default App
