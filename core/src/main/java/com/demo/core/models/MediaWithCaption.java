package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class MediaWithCaption {

    @ValueMapValue
    @Default(values = "image")
    private String mediaType;

    @ValueMapValue
    private String mediaPath;

    @ValueMapValue
    private String posterPath;

    @ValueMapValue
    private String altText;

    @ValueMapValue
    private String caption;

    public String getMediaType() { return mediaType == null ? "image" : mediaType; }
    public boolean isVideo() { return "video".equalsIgnoreCase(getMediaType()); }
    public String getMediaPath() { return mediaPath; }
    public String getPosterPath() { return posterPath; }
    public String getAltText() { return altText == null ? "" : altText; }
    public String getCaption() { return caption; }
    public boolean isHasContent() { return mediaPath != null && !mediaPath.trim().isEmpty(); }
}
