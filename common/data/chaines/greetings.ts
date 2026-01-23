export const hello = () => {
    let greetings: string;
    const hour = new Date().getHours();
    if (hour < 12)
        greetings = 'morning';
    else if (hour < 19)
        greetings = 'afternoon';
    else
        greetings = 'evening';
    return 'Good ' + greetings;
}

const howareyou_list = [
    "What's up ?",
    "Hope you're fine !",
    "How are you ?",
    "What's going on ?",
    "How have you been ?",
    "How's your day going ?"
]

const howareyou = () => {
    const index = Math.floor( Math.random() * howareyou_list.length );
    return howareyou_list[ index ];
}

export default (username: string, withHowAreYou: boolean = true) => hello() + ', ' + username + '. ' + (withHowAreYou ? howareyou() : '');