interface QueueDescriptor {
    queueClass: any; // The queue class itself
    queueInstance?: any; // An instance of the queue
    fileName: string; // The file name
    filePath: string; // The file path
}

export default QueueDescriptor;
