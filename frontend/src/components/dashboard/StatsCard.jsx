import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from "@heroicons/react/24/outline";

const colorClasses = {
  blue: {
    background: "bg-blue-500/20",
    text: "text-blue-500",
  },
  pink: {
    background: "bg-pink-500/20",
    text: "text-pink-500",
  },
  green: {
    background: "bg-green-500/20",
    text: "text-green-500",
  },
};

export const StatsCard = ({icon:Icon, colorIcon, percent, subtext}) => {
    const colors = colorClasses[colorIcon];
    return (
        <div className="rounded-2xl p-5 card-surface border border-slate-700/60 flex flex-col gap-4 item-start">
            <div className="flex justify-between">
                <div className={`${colors.background} grid h-10 w-10 place-items-center rounded-xl`}>
                    <Icon className={`size-5 ${colors.text}`}/>
                </div>
                <div className="text-xs">
                    {
                        (percent > 0) && 
                        <p className="inline-flex gap-1 rounded-md text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 text-[11px] font-semibold">
                            <ArrowTrendingUpIcon className="size-5"/> <span>+ {percent}%</span>
                        </p>
                    }
                    {
                        (percent < 0) && 
                        <p className="inline-flex gap-1 rounded-md text-red-400 bg-red-400/10 px-1.5 py-0.5 text-[11px] font-semibold">
                            <ArrowTrendingDownIcon className="size-5"/> <span>- {percent}%</span>
                        </p>
                    }
                </div>
            </div>
            <div className="grid grid-col">
                <div className="text-white text-3xl font-bold">2,847</div>
                <div className="text-xs text-muted-foreground mt-1">
                    {subtext}
                </div>
            </div>
        </div>
    );
}