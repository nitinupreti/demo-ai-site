package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ValueMap;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import com.demo.core.models.ogs.OgsNewsSlide;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsNewsCarouselModel {

    private final Resource resource;

    @ValueMapValue
    private String heading;

    public OgsNewsCarouselModel(Resource resource) {
        this.resource = resource;
    }

    private List<OgsNewsSlide> slides;

    @PostConstruct
    protected void init() {
        List<OgsNewsSlide> collected = new ArrayList<>();
        Resource root = resource.getChild("slides");
        if (root != null) {
            for (Resource child : root.getChildren()) {
                ValueMap vm = child.getValueMap();
                collected.add(new OgsNewsSlide(
                    vm.get("title", ""),
                    vm.get("image", (String) null),
                    vm.get("description", ""),
                    vm.get("link", (String) null)
                ));
            }
        }
        slides = collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    public String getHeading() {
        return heading;
    }

    public List<OgsNewsSlide> getSlides() {
        return slides;
    }
}
