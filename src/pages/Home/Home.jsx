import { VideoCameraIcon } from "@heroicons/react/24/outline";
import { StatsCard } from "../../components/dashboard/StatsCard";

export const Home = () => {
    return (
        <div className="bg-theme">
           <StatsCard icon={VideoCameraIcon} percent={12} subtext={'Trending Topics'}/>
        </div>
    );
}