import { useState, useEffect } from 'preact/hooks';
export default function useOnScreen( element: React.Ref<HTMLDivElement> | string ) {

    if (SERVER) return false;

    const [isIntersecting, setIntersecting] = useState(false)

    const observer = new IntersectionObserver(
        ([entry]) => setIntersecting(entry.isIntersecting)
    )

    useEffect(() => {

        const elem = typeof element === 'string'
            ? document.querySelector(element)
            : element.current;

        if (!elem) {
            console.warn("useVisible: element to observe do not exists: ", element);
            return;
        }

        observer.observe(elem)
        // Remove the observer as soon as the component is unmounted
        return () => { observer.disconnect() }
    }, [])

    return isIntersecting
}