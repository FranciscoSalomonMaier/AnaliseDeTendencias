import { 
    VideoCameraIcon,
    Square3Stack3DIcon,
    MusicalNoteIcon,
    CameraIcon,
    ChatBubbleOvalLeftIcon,
    ChatBubbleLeftRightIcon,
    MagnifyingGlassIcon,
    ArrowsUpDownIcon
} from "@heroicons/react/24/outline";
import { StatsCard } from "../../components/dashboard/StatsCard";
import { Trends } from "../../components/trend/Trends";
import { AiAnalysisPanel } from "../../components/trend/AiAnalysisPanel";

export const Home = () => {
    return (
        <div className="p-4 bg-theme">
            <div className=" grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatsCard icon={VideoCameraIcon} colorIcon={"blue"} percent={12} subtext={'Trending Topics'}/>
                <StatsCard icon={VideoCameraIcon} colorIcon={"pink"} percent={8.3} subtext={'Trending Topics'}/>
                <StatsCard icon={VideoCameraIcon} colorIcon={"green"} percent={4.1} subtext={'Trending Topics'}/>
                <StatsCard icon={VideoCameraIcon} colorIcon={"green"} percent={-2.1} subtext={'Trending Topics'}/>
            </div>
            <div className="flex justify-between items-center gap-4 py-5">
                <div className="flex justify-between gap-1">
                    <ul className="flex items-center gap-1 rounded-3xl border border-slate-700/60 p-1">
                        <li className="font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <Square3Stack3DIcon className="size-3"/> Todos
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <VideoCameraIcon className="size-3"/> YouTube
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <MusicalNoteIcon className="size-3"/> TikTok
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <CameraIcon className="size-3"/> Instagram
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <ChatBubbleOvalLeftIcon className="size-3"/> X
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <ChatBubbleLeftRightIcon className="size-3"/> Reddit
                            </button>
                        </li>
                        <li className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <MagnifyingGlassIcon className="size-3"/> Google Trends
                            </button>
                        </li>
                    </ul>
                    <div className="rounded-3xl border border-slate-700/60 p-1">
                        <div className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                            <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                                <Square3Stack3DIcon className="size-3"/> Categoria: Todas
                            </button>
                        </div>
                    </div>
                </div>
                <div className="rounded-3xl border border-slate-700/60 p-1">
                    <div className="inline-flex items-center gap-2 font-medium rounded-2xl border border-slate-700/60 text-foreground shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]">
                        <button className="inline-flex h-8 px-2 items-center gap-2 from-primary/20 to-accent-purple/20 text-amber-50 text-xs">
                            <ArrowsUpDownIcon className="size-3"/> Ordenador: Maior Crescimento
                        </button>
                    </div>
                </div>
            </div>
            <div className="rounded-2xl border border-slate-700/60">
                <Trends/>
            </div>
            <div className="mt-4">
                <AiAnalysisPanel/>
            </div>
        </div>
    );
}
