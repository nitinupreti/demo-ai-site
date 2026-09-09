package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CaseStudyGrid {

    @ValueMapValue
    private String sectionHeading;

    @ChildResource
    private List<Tile> items;

    public String getSectionHeading() { return sectionHeading; }

    public List<Tile> getItems() {
        if (items == null) return Collections.emptyList();
        return items.stream().filter(Tile::hasContent).collect(Collectors.toList());
    }

    public boolean isHasContent() {
        return (sectionHeading != null && !sectionHeading.trim().isEmpty()) || !getItems().isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Tile {
        @ValueMapValue private String eyebrow;
        @ValueMapValue private String title;
        @ValueMapValue private String href;
        @ValueMapValue private String thumbnail;
        @ValueMapValue private String thumbnailAlt;
        @ValueMapValue private String logoPath;
        @ValueMapValue private String logoAlt;

        public String getEyebrow() { return eyebrow; }
        public String getTitle() { return title; }
        public String getHref() { return href; }
        public String getThumbnail() { return thumbnail; }
        public String getThumbnailAlt() { return thumbnailAlt == null ? "" : thumbnailAlt; }
        public String getLogoPath() { return logoPath; }
        public String getLogoAlt() { return logoAlt == null ? "" : logoAlt; }
        public boolean hasContent() {
            return title != null && !title.trim().isEmpty()
                && href != null && !href.trim().isEmpty();
        }
    }
}
