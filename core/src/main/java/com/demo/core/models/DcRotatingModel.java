/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class DcRotatingModel {

    @ValueMapValue private String prefix;
    @ChildResource private List<RotatingItem> items;

    @PostConstruct
    protected void init() {
        if (items == null) { items = Collections.emptyList(); return; }
        List<RotatingItem> out = new ArrayList<>();
        for (RotatingItem i : items) {
            if (i != null && StringUtils.isNotBlank(i.getWord())) out.add(i);
        }
        items = out;
    }

    public String getPrefix() { return prefix; }
    public List<RotatingItem> getItems() { return items; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(prefix) || (items != null && !items.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class RotatingItem {
        @ValueMapValue private String word;
        @ValueMapValue private String link;
        @ValueMapValue private String image;
        @ValueMapValue private String imageAlt;
        public String getWord() { return word; }
        public String getLink() { return link; }
        public String getImage() { return image; }
        public String getImageAlt() { return imageAlt; }
    }
}
