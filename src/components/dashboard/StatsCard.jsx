import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from "@heroicons/react/24/outline";

export const StatsCard = ({icon:Icon, percent, subtext}) => {
    return (
        <div className="rounded-2xl border-border">
            <div>
                <div>
                    <Icon/>
                </div>
                <div>
                    {(percent < 0) && <ArrowTrendingUpIcon/>}
                    {(percent > 0) && <ArrowTrendingDownIcon/>}
                    {percent}%
                </div>
            </div>
            <h1 className="text-white">2,847</h1>
            <div>
                {subtext}
            </div>
        </div>
    );
}