import {
    TrophyIcon,
    Squares2X2Icon,
    FireIcon,
    ChartBarIcon,
    PlayCircleIcon,
    MusicalNoteIcon,
    CameraIcon,
    ChatBubbleLeftRightIcon,
    ChatBubbleOvalLeftEllipsisIcon,
    MagnifyingGlassIcon,
    SparklesIcon,
    StarIcon,
    DocumentChartBarIcon,
    Cog6ToothIcon,
    ArrowRightStartOnRectangleIcon,
    ChevronDoubleRightIcon,
    ChevronDoubleLeftIcon
} from "@heroicons/react/24/outline";
import { useState, createContext, useContext } from "react";
const AsideContext = createContext();

export const Aside = ({children}) => {
    const [collapsed, setCollapsed] = useState(false);
    
    return (
        <AsideContext.Provider value={{collapsed, setCollapsed}}>
            <aside className={`
                ${collapsed ? "w-20":"w-65"} 
                sticky
                top-0
                shrink-0
                bg-sidebar 
                border-neutral-gray 
                h-screen 
                flex 
                flex-col
                transation-all
                duration-300
            `}>
                {children}
            </aside>
        </AsideContext.Provider>
    );
}

export const AsideHeader = () => {
    const { collapsed, setCollapsed } = useContext(AsideContext);

    return (
        <div className="flex flex-row gap-2 justify-between p-4">
            <div className="flex flex-row gap-2">
                <div className="grid rounded-2xl gradient-primary h-9 w-9 place-items-center">
                    <SparklesIcon  className="w-6 h-6 text-white text-center"/>
                </div>

                {!collapsed &&(
                <div className="flex flex-col gap-4">
                    <p className="font-semibold text-sm text-white size-2 w-full">Trend Analyzer</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">AI PLATFORM</p>
                </div>)
                }
            </div>

            <button onClick={() => setCollapsed(!collapsed)}>
                {!collapsed && (<ChevronDoubleLeftIcon className="w-4 h-4 text-muted-foreground" />)}
                {collapsed && (<ChevronDoubleRightIcon className="w-4 h-4 text-muted-foreground" />)}
            </button>
        </div>
    );
}

export const AsideBody = () => {
    return (
        <div className="sidebar-scroll overflow-y-auto h-screen">
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
                <AsideOption name="Dashboard" icon={Squares2X2Icon}/>
                <AsideOption name="Trending Now" icon={FireIcon}/>
                <AsideOption name="Trend Explorer" icon={ChartBarIcon}/>
                <AsideOption name="YouTube" icon={PlayCircleIcon}/>
                <AsideOption name="TikTok" icon={MusicalNoteIcon}/>
                <AsideOption name="Instagram" icon={CameraIcon}/>
                <AsideOption name="X (Twitter)" icon={ChatBubbleLeftRightIcon}/>
                <AsideOption name="Reddit" icon={ChatBubbleOvalLeftEllipsisIcon}/>
                <AsideOption name="Google Treads" icon={MagnifyingGlassIcon}/>
                <AsideOption name="All Insights" icon={SparklesIcon}/>
                <AsideOption name="Favoritos" icon={StarIcon}/>
                <AsideOption name="Relatórios" icon={DocumentChartBarIcon}/>
                <AsideOption name="Configuraçãoes" icon={Cog6ToothIcon}/>
            </nav>
        </div>
    );
}

export const AsideBottom = () => {
    const { collapsed } = useContext(AsideContext);

    return (
        <div className="flex flex-col gap-3 p-3">
            {!collapsed && (<div className="rounded-xl p-3 relative overflow-hidden gradient-secondary gradient-border-secondary">
                <div className="flex gap-2 items-center text-xs">
                    <div className="flex gap-2">
                        <TrophyIcon className="lucide lucide-crown h-4 w-4 text-yellow-400 "/>  
                        <span className="text-white text-xs">Plano Premium</span> 
                    </div>
                </div>
                <div className="mt-1 text-muted-foreground text-xs">
                    Acesso ilimitado a todos as APIs
                </div>
                
                <p className="text-[11px] mt-2 font-medium gradient-text">
                    Gerenciar plano 
                </p>
            </div>)}
            <div className="flex justify-between">
                <div className="flex gap-2">
                    <button className="rounded-full h-9 w-9 text-white place-items-center font-bold gradient-primary">
                        FM
                    </button>
                    {!collapsed && (<div className="flex flex-col gap-1">
                        <span className="text-xs text-white font-extralight">Francisco Maier</span>
                        <span className="text-muted-foreground text-[10px]">Francisco@trendai.com</span>
                    </div>)}
                </div>
                {!collapsed && 
                (<button>
                    <ArrowRightStartOnRectangleIcon  className="text-muted-foreground w-6 h-6"/>
                </button>
                )}
            </div>
        </div>
    );
}

const AsideOption = ({ name, icon: Icon }) => {
    const { collapsed } = useContext(AsideContext);
    return (
        <button className="flex gap-1 font-extralight text-muted-foreground transition-all text-sm rounded-lg w-full py-2 px-3 hover:text-white hover:bg-sidebar-accent/60">
            <Icon className="w-5 h-5 text-muted-foreground"/>
            {!collapsed && (
                <span className="text-sm text-muted-foreground">
                    {name}
                </span>
            )}
        </button>
    );
};

Aside.Header = AsideHeader;
Aside.Body = AsideBody;
Aside.Bottom = AsideBottom;

export default Aside;