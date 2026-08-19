# briefrender
Open-source pipeline that turns data into professional-quality narrated videos.

briefrender turns slide decks, PDFs, and Jupyter notebooks into short narrated explainer videos. It breaks your source into its component parts, writes narration grounded in a holistic understanding of your content, and renders a video that breifs the viewer on the content. Built as a clean pipeline with swappable stages to increase reliability, as well as minimize rendering and LLM costs: decompose -> annotate -> plan -> render. Self-hostable with Docker, or use hosted cloud. 
