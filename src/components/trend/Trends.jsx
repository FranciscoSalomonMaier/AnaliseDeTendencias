import { useEffect, useState } from "react";
import { getPopularVideos } from "../../services/youtubeService"
import { SparklesIcon } from "@heroicons/react/24/outline";

export const Trends = () => {
    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadVideos() {
            try {
                const data = await getPopularVideos();
                setVideos(data);
                console.log(data);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        }
        loadVideos();

        console.log(videos);
    }, []);

    if (loading) {
        return <p>Carregando</p>;
    }

    return (
        <div className="card-surface">
            <div className="inline-flex gap-2 px-5 py-3 w-full">
                <div className="grid rounded-2xl gradient-primary h-9 w-9 place-items-center">
                    <SparklesIcon  className="w-6 h-6 text-white text-center"/>
                </div>
                <div className="flex justify-between w-full">
                    <div className="flex flex-col">
                        <h3 className="text-sm font-semibold text-white">
                            TOP 10 Trends do Momento
                        </h3>
                        <div className="text-[11px] text-muted-foreground">
                            Atualizado em tempo real - Última sync há 12s
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground">Live</div>
                </div>
            </div>
            <table className="w-full text-sm">
                <thead className="border-top-2 border-bottom-2 border-muted-foreground">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="px-5 py-3 font-medium">#</th>
                        <th className="px-5 py-3 font-medium">TENDÊNCIA</th>
                        <th className="px-5 py-3 font-medium">CATEGORIA</th>
                        <th className="px-5 py-3 font-medium">PLATAFORMA</th>
                        <th className="px-5 py-3 font-medium">SCORE IA</th>
                        <th className="px-5 py-3 font-medium">VIEWS</th>
                        <th className="px-5 py-3 font-medium">CRESCIMENTO</th>
                        <th className="px-5 py-3 font-medium">STATUS</th>
                        <th className="px-5 py-3 font-medium">ATUALIZADO</th>
                    </tr>
                </thead>
                <tbody>
                    {videos.map((video, index) => (
                        <tr className="">
                            <td className="px-5 py-3">
                                {((index + 1) <= 3)  &&
                                <div className="grid rounded-xl gradient-primary font-bold text-white h-7 w-7 place-items-center">
                                    {index + 1}
                                </div>
                                }
                                {((index + 1) > 3)  &&
                                <div className="grid rounded-xl bg-card-elevated text-muted-foreground font-bold  h-7 w-7 place-items-center">
                                    {index + 1}
                                </div>
                                }
                            </td>
                            <td className="w-32 max-w-32 px-5 py-3 text-white font-bold whitespace-normal break-words">{video.snippet.tags?.[0]}</td>
                            <td className="px-5 py-3 text-xs text-muted-foreground">{video.categoryTitle}</td>
                            <td className="px-5 py-3">
                                <div className="inline-flex items-center gap-2 text-xs text-white">
                                    {video.kind.split("#")?.[0]}
                                </div>
                            </td>
                            <td className="px-5 py-3"></td>
                            <td className="px-5 py-3 text-muted-foreground">{video.numberView}</td>
                            <td className="px-5 py-3"></td>
                            <td className="px-5 py-3"></td>
                            <td className="px-5 py-3"></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

}