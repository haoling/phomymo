# 素材集(#27)の英語の表示名。build-assets.py が読む(表示言語が English のとき使う)。
# Tabler Icons はアイコン名から作るので、ここには変えたいものだけ書く。

CATEGORIES_EN = {
    "marks": "Marks & symbols",
    "living": "Home & storage",
    "food": "Kitchen & food",
    "office": "Stationery & work",
    "caution": "Caution & handling",
    "nature": "Weather & nature",
    "animals": "Animals",
    "hobby": "Hobbies & fandom",
    "arrows": "Arrows",
    "emoji": "Emoji",
    "stickers": "Stickers",
}

TWEMOJI_EN = {
    "2764": "Heart", "1f495": "Two hearts", "2b50": "Star", "2728": "Sparkles",
    "1f338": "Cherry blossom", "1f340": "Four-leaf clover", "1f380": "Ribbon", "1f381": "Gift",
    "1f382": "Birthday cake", "1f389": "Party popper", "1f431": "Cat", "1f436": "Dog",
    "1f430": "Rabbit", "1f43b": "Bear", "1f43c": "Panda", "1f427": "Penguin",
    "1f98a": "Fox", "1f41f": "Fish", "1f34e": "Apple", "1f353": "Strawberry",
    "1f359": "Rice ball", "1f370": "Shortcake", "1f361": "Dango", "2615": "Coffee",
    "1f375": "Tea", "1f37a": "Beer", "1f377": "Wine", "1f95b": "Milk",
    "1f35e": "Bread", "1f95a": "Egg", "1f9c2": "Salt", "1f373": "Fried egg",
    "2705": "Check", "274c": "Cross", "26a0": "Warning", "26d4": "No entry",
    "2757": "Exclamation", "2753": "Question", "1f4a1": "Light bulb", "1f4e6": "Package",
    "1f4cc": "Pushpin", "1f4ce": "Paperclip", "2702": "Scissors", "1f4da": "Books",
    "1f4dd": "Memo", "1f4c5": "Calendar", "23f0": "Alarm clock", "1f511": "Key",
    "1f512": "Lock", "1f3e0": "House", "1f9fa": "Basket", "1f9f4": "Bottle",
    "1f9fb": "Toilet paper", "1f48a": "Medicine", "1fa79": "Bandage", "1f3b5": "Music note",
    "1f3ae": "Game", "1f3a4": "Microphone", "1f4f7": "Camera", "1f319": "Crescent moon",
    "2600": "Sunny", "2601": "Cloudy", "2614": "Rain", "2744": "Snow",
    "1f525": "Fire", "1f4a7": "Droplet", "1f308": "Rainbow", "1f600": "Grinning face",
    "1f60a": "Smiling face", "1f60d": "Heart eyes", "1f602": "Tears of joy", "1f622": "Crying face",
    "1f621": "Angry face", "1f970": "Smiling face with hearts", "1f60e": "Sunglasses", "1f914": "Thinking face",
    "1f44d": "Thumbs up", "1f44f": "Clapping", "1f64f": "Please", "1f4af": "100 points",
    "1f197": "OK", "1f195": "NEW", "1f250": "Bargain", "1f530": "Beginner",
    "2668": "Hot springs", "1f5fb": "Mount Fuji", "1f38d": "Kadomatsu",
}

STICKERS_EN = {
    "starburst": "Starburst badge", "rosette": "Rosette", "ribbon-banner": "Ribbon banner",
    "speech-bubble": "Speech bubble", "thought-bubble": "Thought bubble", "tag-shape": "Tag",
    "circle-badge": "Double circle badge", "heart-badge": "Heart badge", "cloud-badge": "Cloud badge",
    "flower-badge": "Flower badge", "price-plate": "Plate", "arrow-banner": "Arrow banner",
}

# Tabler Icons のアイコン名から作った英語名を変えたいとき(例: "number-1": "1")
TABLER_EN = {
    "number-1": "1", "number-2": "2", "number-3": "3", "qrcode": "QR", "wifi": "Wi-Fi",
    "x": "Cross", "currency-yen": "Yen", "usb": "USB",
}


def tabler_name_en(base):
    """Tabler のアイコン名(例: tools-kitchen-2)から英語の表示名を作る"""
    if base in TABLER_EN:
        return TABLER_EN[base]
    words = [w for w in base.split('-') if not w.isdigit()]
    s = ' '.join(words) or base
    return s[:1].upper() + s[1:]
